import { basename, join } from "path";
import { CONFIG_DIR } from "./config.ts";
import { die } from "./errors.ts";

export const BIND_DIR = join(CONFIG_DIR, "bin");

// Bun compiled binary에서 process.execPath는 이미 realpath로 resolve됨
function getClipBinPath(): string {
  const execPath = process.execPath;
  if (basename(execPath) === "bun") {
    die("clip bind requires a compiled binary. Run: bun run build first.");
  }
  return execPath;
}

export async function bindTarget(name: string): Promise<void> {
  if (name === "clip") die('Cannot bind "clip" — would cause infinite recursion.');

  const clipBin = getClipBinPath();
  await Bun.spawn(["mkdir", "-p", BIND_DIR]).exited;

  const shimPath = join(BIND_DIR, name);
  // shim 스크립트: exec으로 clip <name>에 위임 (symlink 불가 — Bun이 argv[0] 이름을 전달 안 함)
  const shimContent = `#!/bin/sh\nexec ${clipBin} ${name} "$@"\n`;
  await Bun.write(shimPath, shimContent);
  await Bun.spawn(["chmod", "+x", shimPath]).exited;

  console.log(`Bound "${name}" → ${shimPath}`);

  const pathDirs = (process.env.PATH ?? "").split(":");
  if (!pathDirs.includes(BIND_DIR)) {
    console.log(`\nNote: ${BIND_DIR} is not in your PATH.`);
    console.log(`Add this to your shell profile (before other PATH entries):`);
    console.log(`  export PATH="${BIND_DIR}:$PATH"`);
  }
}

export async function unbindTarget(name: string): Promise<void> {
  const shimPath = join(BIND_DIR, name);
  const content = await Bun.file(shimPath).text().catch(() => null);
  if (content === null) {
    console.log(`"${name}" is not bound.`);
    return;
  }
  // BIND_DIR 안에 있는 파일만 관리 — shim 여부를 간단히 검증
  if (!content.startsWith("#!/bin/sh")) {
    die(`"${shimPath}" does not look like a clip shim. Remove manually if needed.`);
  }
  await Bun.spawn(["rm", "-f", shimPath]).exited;
  console.log(`Unbound "${name}".`);
}

export async function listBound(): Promise<string[]> {
  const testProc = Bun.spawn(["test", "-d", BIND_DIR], { stdout: "pipe", stderr: "pipe" });
  await testProc.exited;
  if (testProc.exitCode !== 0) return [];

  const lsProc = Bun.spawn(["ls", "-1", BIND_DIR], { stdout: "pipe", stderr: "pipe" });
  await lsProc.exited;
  const out = (await new Response(lsProc.stdout as ReadableStream<Uint8Array>).text()).trim();
  if (!out) return [];
  return out.split("\n").filter(Boolean);
}
