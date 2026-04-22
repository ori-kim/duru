/**
 * clip ext — extension 관리 서브커맨드
 *
 *   clip ext list              — 내장 + 사용자 선언 전체 표시
 *   clip ext enable <name>     — manifest entry enabled: true
 *   clip ext disable <name>    — manifest entry enabled: false
 *   clip ext scaffold <name>   — extension 폴더 + tsconfig 스캐폴드 생성
 *   clip ext types             — IDE 타입 파일을 CLIP_HOME/types/@clip/core/ 에 배포
 *   clip ext reload <name>     — import 캐시 무효화 (개발 편의)
 */
import { die, CONFIG_DIR, type Registry } from "@clip/core";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { parse as yamlParse, stringify as yamlStringify } from "yaml";
import {
  setExtensionEnabled,
  type ExtensionEntry,
} from "../extension-loader.ts";
import { deriveBuiltinEntries } from "../builtin-loader.ts";

// ---------------------------------------------------------------------------
// manifest 직접 읽기 (loader context 없는 경우를 위한 fallback)
// ---------------------------------------------------------------------------

function getManifestPath(): string {
  return process.env["CLIP_EXT_MANIFEST"] ?? join(CONFIG_DIR, "extensions", "extensions.yml");
}

function readUserEntries(): ExtensionEntry[] {
  const manifestPath = getManifestPath();
  if (!existsSync(manifestPath)) return [];
  try {
    const raw = readFileSync(manifestPath, "utf8");
    const parsed = yamlParse(raw) as { extensions?: ExtensionEntry[] } | null;
    if (!parsed || !Array.isArray(parsed.extensions)) return [];
    return parsed.extensions as ExtensionEntry[];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// 서브커맨드 핸들러
// ---------------------------------------------------------------------------

function cmdList(registry: Registry): void {
  const tty = process.stdout.isTTY;
  const bold = (s: string) => (tty ? `\x1b[1m${s}\x1b[0m` : s);
  const dim = (s: string) => (tty ? `\x1b[2m${s}\x1b[0m` : s);
  const green = (s: string) => (tty ? `\x1b[32m${s}\x1b[0m` : s);
  const red = (s: string) => (tty ? `\x1b[31m${s}\x1b[0m` : s);

  // loader.listEntries()는 enabled 항목만 반환하므로 manifest를 직접 읽어 disabled 항목도 표시
  const userEntries = readUserEntries();

  const allEntries: Array<{ entry: ExtensionEntry; kind: "builtin" | "user" }> = [
    ...deriveBuiltinEntries(registry).map((e) => ({ entry: e, kind: "builtin" as const })),
    ...userEntries.map((e) => ({ entry: e, kind: "user" as const })),
  ];

  const nameW = Math.max(4, ...allEntries.map(({ entry: e }) => e.name.length));
  const kindW = 7; // "builtin"
  const statusW = 8; // "disabled"

  const sep = (w: number) => "─".repeat(w);
  const divider = `${sep(nameW)}  ${sep(kindW)}  ${sep(statusW)}  CONTRIBUTES`;

  console.log(`${bold("NAME".padEnd(nameW))}  ${"KIND".padEnd(kindW)}  ${"STATUS".padEnd(statusW)}  CONTRIBUTES`);
  console.log(dim(divider));

  for (const { entry: e, kind } of allEntries) {
    const enabled = e.enabled !== false;
    const status = enabled ? green("enabled") : red("disabled");
    const statusPad = status + " ".repeat(Math.max(0, statusW - (enabled ? 7 : 8)));

    const contributes: string[] = [];
    if (e.contributes?.internalCommands?.length) {
      contributes.push(`cmds=[${e.contributes.internalCommands.join(",")}]`);
    }
    if (e.contributes?.targetTypes?.length) {
      const typeNames = (e.contributes.targetTypes as Array<string | { name: string }>)
        .map((t) => (typeof t === "string" ? t : t.name));
      contributes.push(`types=[${typeNames.join(",")}]`);
    }
    if (e.contributes?.hooks?.length) {
      contributes.push(`hooks=[${e.contributes.hooks.join(",")}]`);
    }

    console.log(
      `${e.name.padEnd(nameW)}  ${kind.padEnd(kindW)}  ${statusPad}  ${dim(contributes.join(" ") || "—")}`,
    );
  }

  if (userEntries.length === 0) {
    console.log(dim(`\nNo user extensions declared. Add entries to: ${getManifestPath()}`));
  }
}

function cmdEnable(args: string[]): void {
  const name = args[0];
  if (!name) die("Usage: clip ext enable <name>");
  setExtensionEnabled(name, true);
  console.log(`Extension "${name}" enabled.`);
  console.log("Restart clip to take effect.");
}

function cmdDisable(args: string[]): void {
  const name = args[0];
  if (!name) die("Usage: clip ext disable <name>");
  setExtensionEnabled(name, false);
  console.log(`Extension "${name}" disabled.`);
  console.log("Restart clip to take effect.");
}

function cmdReload(args: string[]): void {
  const name = args[0];
  if (!name) die("Usage: clip ext reload <name>");
  // Bun은 require.cache 같은 명시적 모듈 캐시 무효화 API가 없음.
  // 성공 코드로 종료하면 자동화 스크립트가 상태 변경이 일어난 것으로 오인하므로 비0 종료.
  process.stderr.write(
    `clip: ext reload is not supported. Bun does not expose an import cache flush API.\n` +
    `To apply changes, restart clip.\n`,
  );
  process.exit(1);
}

// core 타입 파일을 CONFIG_DIR/types/@clip/core/ 에 dump
async function deployTypes(): Promise<void> {
  const { getCoreTypeFiles } = await import("../core-type-bundle.ts");
  const destBase = join(CONFIG_DIR, "types", "@clip", "core");
  const files = getCoreTypeFiles();
  for (const { path, content } of files) {
    const destPath = join(destBase, path);
    mkdirSync(dirname(destPath), { recursive: true });
    writeFileSync(destPath, content, "utf8");
  }
  console.log(`Types deployed to: ${destBase}`);
}

async function cmdTypes(): Promise<void> {
  await deployTypes();
  console.log(`\nTo use in your extension's tsconfig.json:`);
  console.log(JSON.stringify({
    compilerOptions: {
      paths: { "@clip/core": [`${join(CONFIG_DIR, "types", "@clip", "core", "src", "index.ts")}`] },
    },
  }, null, 2));
}

const EXTENSION_SCAFFOLD = `import type { ClipExtension } from "@clip/core";

export const extension: ClipExtension = {
  name: "ext:NAME",
  init(api) {
    api.registerInternalCommand("NAME", async ({ args }) => {
      // TODO: implement
      console.log("NAME args:", args);
    });
  },
};
`;

const MANIFEST_ENTRY_TEMPLATE = (name: string) => ({
  name,
  path: name,
  entry: "src/extension.ts",
  enabled: true,
  contributes: { internalCommands: [name], targetTypes: [], hooks: [] },
});

async function cmdScaffold(args: string[]): Promise<void> {
  const name = args[0];
  if (!name) die("Usage: clip ext scaffold <name>");
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) die("Extension name may only contain letters, digits, _ and -");

  const manifestPath = getManifestPath();
  const extDir = join(dirname(manifestPath), name);
  const srcDir = join(extDir, "src");

  if (existsSync(join(srcDir, "extension.ts"))) {
    die(`Extension "${name}" already exists at ${extDir}`);
  }

  // 매니페스트를 먼저 읽어 유효성 검증 — 파싱 실패 시 파일 생성 전 중단
  let manifest: { extensions: unknown[] } = { extensions: [] };
  if (existsSync(manifestPath)) {
    let raw: string;
    try {
      raw = readFileSync(manifestPath, "utf8");
    } catch (e) {
      die(`Cannot read manifest at ${manifestPath}: ${e}`);
    }
    try {
      const parsed = yamlParse(raw!) as typeof manifest;
      if (parsed != null && typeof parsed !== "object") die(`Manifest at ${manifestPath} is not a valid YAML object`);
      if (parsed != null) manifest = parsed;
    } catch (e) {
      die(`Manifest at ${manifestPath} contains invalid YAML — fix it before scaffolding: ${e}`);
    }
  } else {
    mkdirSync(dirname(manifestPath), { recursive: true });
  }
  if (!Array.isArray(manifest.extensions)) manifest.extensions = [];

  const alreadyExists = (manifest.extensions as Array<{ name: string }>).some((e) => e.name === name);

  // 파일 생성
  mkdirSync(srcDir, { recursive: true });

  // extension.ts 스캐폴드
  writeFileSync(join(srcDir, "extension.ts"), EXTENSION_SCAFFOLD.replaceAll("NAME", name), "utf8");

  // core 타입 배포
  await deployTypes();
  const typesAbsPath = join(CONFIG_DIR, "types", "@clip", "core", "src", "index.ts");

  // tsconfig.json
  const tsconfig = {
    compilerOptions: {
      module: "Preserve",
      moduleResolution: "bundler",
      allowImportingTsExtensions: true,
      verbatimModuleSyntax: true,
      strict: true,
      paths: { "@clip/core": [typesAbsPath] },
    },
  };
  writeFileSync(join(extDir, "tsconfig.json"), JSON.stringify(tsconfig, null, 2) + "\n", "utf8");

  // package.json — yaml/zod 트랜지티브 타입을 에디터가 resolve할 수 있도록 devDeps 명시
  const pkgJson = { private: true, devDependencies: { yaml: "*", zod: "*" } };
  writeFileSync(join(extDir, "package.json"), JSON.stringify(pkgJson, null, 2) + "\n", "utf8");

  // extensions.yml에 entry 추가
  if (!alreadyExists) {
    manifest.extensions.push(MANIFEST_ENTRY_TEMPLATE(name));
    writeFileSync(manifestPath, yamlStringify(manifest), "utf8");
  }

  console.log(`Extension scaffold created: ${extDir}`);
  console.log(`  - ${join(srcDir, "extension.ts")}`);
  console.log(`  - ${join(extDir, "tsconfig.json")}`);
  console.log(`  - ${join(extDir, "package.json")}`);
  console.log(`  - manifest entry added: ${manifestPath}`);
  console.log(`\nRun \`bun install\` in ${extDir} to set up editor types.`);
  console.log(`Then open ${join(srcDir, "extension.ts")} and start coding.`);
  console.log(`Run: clip ${name} (after implementing registerInternalCommand)`);
}

// ---------------------------------------------------------------------------
// 공개 진입점
// ---------------------------------------------------------------------------

export async function runExtCmd(args: string[], registry: Registry): Promise<void> {
  const sub = args[0];
  const rest = args.slice(1);

  switch (sub) {
    case "list":
      cmdList(registry);
      break;
    case "enable":
      cmdEnable(rest);
      break;
    case "disable":
      cmdDisable(rest);
      break;
    case "scaffold":
      await cmdScaffold(rest);
      break;
    case "types":
      await cmdTypes();
      break;
    case "reload":
      cmdReload(rest);
      break;
    default:
      die(
        [
          "Usage: clip ext <subcommand> [args]",
          "",
          "  list               Show all extensions (builtin + user declared)",
          "  enable <name>      Set entry enabled: true in manifest",
          "  disable <name>     Set entry disabled in manifest",
          "  scaffold <name>    Create extension folder + tsconfig scaffold",
          "  types              Deploy @clip/core types to CLIP_HOME/types/",
          "  reload <name>      Flush import cache (development helper)",
          "",
          "Manifest location: " + getManifestPath(),
        ].join("\n"),
      );
  }
}
