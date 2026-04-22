/**
 * extension-loader.ts — Phase 2 lazy init 검증
 *
 * 완료 조건: hooks 선언 없는 extension은 argv 미매칭 시 import가 발생하지 않음.
 */
import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { Registry } from "@clip/core";
import { loadUserExtensions } from "./extension-loader.ts";

// ---------------------------------------------------------------------------
// 헬퍼: 임시 manifest + extension 파일 생성
// ---------------------------------------------------------------------------

function createTmpExtension(dir: string, name: string, opts: {
  hooks?: boolean;
  internalCommands?: string[];
  targetTypes?: string[];
}): string {
  const extDir = join(dir, name);
  mkdirSync(extDir, { recursive: true });
  const entryFile = join(extDir, "index.ts");
  // 파일이 import되면 전역 Set에 이름을 기록하는 side-effect 구현
  writeFileSync(entryFile, `
import type { ClipExtension } from "@clip/core";
(globalThis as any).__imported ??= new Set<string>();
(globalThis as any).__imported.add(${JSON.stringify(name)});
export const extension: ClipExtension = {
  name: ${JSON.stringify("ext:" + name)},
  init(_api) {},
};
`);
  return extDir;
}

function createTmpManifest(dir: string, extensions: Array<{
  name: string;
  path: string;
  hooks?: boolean;
  internalCommands?: string[];
  targetTypes?: string[];
}>): string {
  const manifestPath = join(dir, "extensions.yml");
  const lines = ["extensions:"];
  for (const e of extensions) {
    lines.push(`  - name: ${e.name}`);
    lines.push(`    path: ${e.path}`);
    lines.push(`    entry: index.ts`);
    const cmds = e.internalCommands ?? [];
    const types = e.targetTypes ?? [];
    const hooks = e.hooks ? ["startup"] : [];
    lines.push(`    contributes:`);
    lines.push(`      internalCommands: [${cmds.map(c => JSON.stringify(c)).join(", ")}]`);
    lines.push(`      targetTypes: [${types.map(t => JSON.stringify(t)).join(", ")}]`);
    lines.push(`      hooks: [${hooks.map(h => JSON.stringify(h)).join(", ")}]`);
  }
  writeFileSync(manifestPath, lines.join("\n") + "\n");
  return manifestPath;
}

// ---------------------------------------------------------------------------
// 테스트
// ---------------------------------------------------------------------------

describe("extension-loader / Phase 2 lazy init", () => {
  test("argv='list' — skills extension(internalCommands=['skills'])은 import 안 됨", async () => {
    const dir = mkdtempSync(join(tmpdir(), "clip-ext-test-"));
    const extDir = createTmpExtension(dir, "skills-ext", { internalCommands: ["skills"] });
    const manifestPath = createTmpManifest(dir, [
      { name: "skills-ext", path: extDir, internalCommands: ["skills"] },
    ]);

    // globalThis.__imported 초기화
    (globalThis as Record<string, unknown>)["__imported"] = new Set<string>();

    const registry = new Registry();
    process.env["CLIP_EXT_MANIFEST"] = manifestPath;

    // argv = ["list"] — skills와 무관한 커맨드
    await loadUserExtensions(registry, ["list"]);
    await registry.initAll();

    const imported = (globalThis as Record<string, unknown>)["__imported"] as Set<string>;
    expect(imported.has("skills-ext")).toBe(false);

    delete process.env["CLIP_EXT_MANIFEST"];
  });

  test("argv='skills' — skills extension은 import 됨", async () => {
    const dir = mkdtempSync(join(tmpdir(), "clip-ext-test-"));
    const extDir = createTmpExtension(dir, "skills-ext2", { internalCommands: ["skills"] });
    const manifestPath = createTmpManifest(dir, [
      { name: "skills-ext2", path: extDir, internalCommands: ["skills"] },
    ]);

    (globalThis as Record<string, unknown>)["__imported"] = new Set<string>();

    const registry = new Registry();
    process.env["CLIP_EXT_MANIFEST"] = manifestPath;

    // argv = ["skills"] — skills에 매칭
    await loadUserExtensions(registry, ["skills"]);
    await registry.initAll();

    const imported = (globalThis as Record<string, unknown>)["__imported"] as Set<string>;
    expect(imported.has("skills-ext2")).toBe(true);

    delete process.env["CLIP_EXT_MANIFEST"];
  });

  test("hooks 선언 extension은 argv 무관하게 항상 import 됨 (eager)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "clip-ext-test-"));
    const extDir = createTmpExtension(dir, "hooks-ext", { hooks: true });
    const manifestPath = createTmpManifest(dir, [
      { name: "hooks-ext", path: extDir, hooks: true },
    ]);

    (globalThis as Record<string, unknown>)["__imported"] = new Set<string>();

    const registry = new Registry();
    process.env["CLIP_EXT_MANIFEST"] = manifestPath;

    // argv = ["list"] — hooks-ext와 무관한 커맨드지만 hooks 선언 → eager
    await loadUserExtensions(registry, ["list"]);
    await registry.initAll();

    const imported = (globalThis as Record<string, unknown>)["__imported"] as Set<string>;
    expect(imported.has("hooks-ext")).toBe(true);

    delete process.env["CLIP_EXT_MANIFEST"];
  });

  test("manifest 없으면 extension 0개 등록 — loader.phase1Entries 빈 배열", async () => {
    process.env["CLIP_EXT_MANIFEST"] = "/nonexistent/path/extensions.yml";
    const registry = new Registry();
    const loader = await loadUserExtensions(registry, ["list"]);
    expect(loader.phase1Entries).toHaveLength(0);
    expect(loader.listEntries()).toHaveLength(0);
    delete process.env["CLIP_EXT_MANIFEST"];
  });
});
