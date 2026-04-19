import { readdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import type { Registry } from "./extension.ts";

const DEFAULT_EXT_DIR = join(homedir(), ".clip", "extensions");

function getExtDir(): string {
  return process.env["CLIP_EXT_DIR"] ?? DEFAULT_EXT_DIR;
}

function isSkipped(): boolean {
  return process.env["CLIP_NO_EXTENSIONS"] === "1";
}

function isStrict(): boolean {
  return process.env["CLIP_EXT_STRICT"] === "1";
}

function isTrace(): boolean {
  return process.env["CLIP_EXT_TRACE"] === "1";
}

function trace(msg: string): void {
  if (isTrace()) process.stderr.write(`[clip:ext] ${msg}\n`);
}

export async function loadUserExtensions(registry: Registry): Promise<void> {
  if (isSkipped()) {
    trace("CLIP_NO_EXTENSIONS=1, skipping user extensions");
    return;
  }

  const extDir = getExtDir();
  let files: string[];
  try {
    files = readdirSync(extDir)
      .filter((f) => f.endsWith(".ts") || f.endsWith(".js"))
      .sort(); // 파일명 사전순으로 로드 순서 결정
  } catch {
    // extensions 디렉토리가 없으면 조용히 skip
    trace(`extensions dir not found: ${extDir}`);
    return;
  }

  for (const file of files) {
    const filePath = join(extDir, file);
    trace(`loading extension: ${filePath}`);
    try {
      const mod = await import(filePath);
      const ext = mod.extension ?? mod.default?.extension ?? mod.default;
      if (!ext || typeof ext.name !== "string" || typeof ext.init !== "function") {
        const msg = `extension "${file}" must export { extension: ClipExtension }`;
        if (isStrict()) throw new Error(msg);
        process.stderr.write(`clip: warning: ${msg}\n`);
        continue;
      }
      registry.register(ext);
      trace(`registered extension: ${ext.name} (${file})`);
    } catch (e) {
      const msg = `failed to load extension "${file}": ${e instanceof Error ? e.message : String(e)}`;
      if (isStrict()) throw new Error(msg);
      process.stderr.write(`clip: warning: ${msg}\n`);
    }
  }
}
