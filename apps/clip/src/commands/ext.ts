/**
 * clip ext — extension 관리 서브커맨드
 *
 *   clip ext list            — 내장 + 사용자 선언 전체 표시
 *   clip ext enable <name>   — manifest entry enabled: true
 *   clip ext disable <name>  — manifest entry enabled: false
 *   clip ext reload <name>   — import 캐시 무효화 (개발 편의)
 */
import { die } from "@clip/core";
import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { parse as yamlParse } from "yaml";
import {
  setExtensionEnabled,
  type ExtensionEntry,
} from "../extension-loader.ts";
import { BUILTIN_EXTENSION_ENTRIES as BUILTIN_EXTENSIONS } from "../builtin-loader.ts";

// ---------------------------------------------------------------------------
// manifest 직접 읽기 (loader context 없는 경우를 위한 fallback)
// ---------------------------------------------------------------------------

function getManifestPath(): string {
  return (
    process.env["CLIP_EXT_MANIFEST"] ??
    join(homedir(), ".clip", "extensions", "extensions.yml")
  );
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

function cmdList(): void {
  const tty = process.stdout.isTTY;
  const bold = (s: string) => (tty ? `\x1b[1m${s}\x1b[0m` : s);
  const dim = (s: string) => (tty ? `\x1b[2m${s}\x1b[0m` : s);
  const green = (s: string) => (tty ? `\x1b[32m${s}\x1b[0m` : s);
  const red = (s: string) => (tty ? `\x1b[31m${s}\x1b[0m` : s);

  // loader.listEntries()는 enabled 항목만 반환하므로 manifest를 직접 읽어 disabled 항목도 표시
  const userEntries = readUserEntries();

  const allEntries: Array<{ entry: ExtensionEntry; kind: "builtin" | "user" }> = [
    ...BUILTIN_EXTENSIONS.map((e) => ({ entry: e, kind: "builtin" as const })),
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
      contributes.push(`types=[${e.contributes.targetTypes.join(",")}]`);
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

// ---------------------------------------------------------------------------
// 공개 진입점
// ---------------------------------------------------------------------------

export async function runExtCmd(args: string[]): Promise<void> {
  const sub = args[0];
  const rest = args.slice(1);

  switch (sub) {
    case "list":
      cmdList();
      break;
    case "enable":
      cmdEnable(rest);
      break;
    case "disable":
      cmdDisable(rest);
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
          "  reload <name>      Flush import cache (development helper)",
          "",
          "Manifest location: " + getManifestPath(),
        ].join("\n"),
      );
  }
}
