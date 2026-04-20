import { describe, expect, test } from "bun:test";
import { ClipError } from "../utils/errors.ts";
import { runSkillsCmd } from "./skills.ts";

// --- validation (loadConfig 호출 이전에 throw) ---

describe("runSkillsCmd / validation", () => {
  test("subcommand 없음 → ClipError (Usage 포함)", async () => {
    await Promise.all([
      expect(runSkillsCmd([])).rejects.toThrow(ClipError),
      expect(runSkillsCmd([])).rejects.toThrow(/Usage/),
    ]);
  });

  test("'add' 아닌 subcommand → ClipError", async () => {
    await Promise.all([
      expect(runSkillsCmd(["list"])).rejects.toThrow(ClipError),
      expect(runSkillsCmd(["install"])).rejects.toThrow(ClipError),
      expect(runSkillsCmd(["help"])).rejects.toThrow(ClipError),
    ]);
  });

  test("'add' 후 integration 없음 → ClipError (Available 포함)", async () => {
    await Promise.all([
      expect(runSkillsCmd(["add"])).rejects.toThrow(ClipError),
      expect(runSkillsCmd(["add"])).rejects.toThrow(/Available/),
    ]);
  });

  test("알 수 없는 integration → ClipError (Unknown integration 포함)", async () => {
    await Promise.all([
      expect(runSkillsCmd(["add", "cursor"])).rejects.toThrow(ClipError),
      expect(runSkillsCmd(["add", "cursor"])).rejects.toThrow(/Unknown integration/),
    ]);
  });

  test("Unknown integration 오류 메시지에 Available 목록 포함", async () => {
    try {
      await runSkillsCmd(["add", "unknown-xyz"]);
      expect(true).toBe(false); // 도달하면 안 됨
    } catch (e) {
      expect(e).toBeInstanceOf(ClipError);
      const msg = (e as ClipError).message;
      expect(msg).toContain("claude-code");
      expect(msg).toContain("gemini");
      expect(msg).toContain("codex");
      expect(msg).toContain("pi");
    }
  });
});

// --- 지원 integration 목록 — 소스 레벨 검증 (설치 없음) ---
// 실제 설치는 FS 사이드 이펙트가 크기 때문에 소스 코드 구조로만 확인

describe("runSkillsCmd / available integrations (소스 검증)", () => {
  test("INTEGRATIONS 상수에 claude-code, codex, gemini, pi 포함", async () => {
    // 알 수 없는 integration 오류 메시지에서 Available 목록을 읽어 검증
    try {
      await runSkillsCmd(["add", "__probe__"]);
    } catch (e) {
      expect(e).toBeInstanceOf(ClipError);
      const msg = (e as ClipError).message;
      expect(msg).toContain("claude-code");
      expect(msg).toContain("codex");
      expect(msg).toContain("gemini");
      expect(msg).toContain("pi");
    }
  });
});

// --- 회귀: script 타겟 누락 버그 ---
// runSkillsCmd의 targetNames에 config.script가 포함되어야 함.
// 이전에는 누락되어 있었고 bind --all과 동작이 달랐음.

describe("runSkillsCmd / script 타겟 포함 (회귀 테스트)", () => {
  test("config.script 키가 targetNames에 포함되는지 소스 레벨 검증", async () => {
    // 이 테스트는 소스 코드 패턴을 직접 검사함
    // skills.ts 파일을 읽어서 config.script가 targetNames에 포함되는지 확인
    const fs = await import("fs");
    const path = await import("path");
    const { fileURLToPath } = await import("url");
    const dir = path.dirname(fileURLToPath(import.meta.url));
    const content = fs.readFileSync(path.join(dir, "skills.ts"), "utf8");

    // targetNames 블록에서 config.script가 스프레드되어야 함
    expect(content).toMatch(/Object\.keys\(config\.script\)/);
  });
});
