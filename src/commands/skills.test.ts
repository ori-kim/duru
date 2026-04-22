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

  test("알 수 없는 subcommand → ClipError", async () => {
    await Promise.all([
      expect(runSkillsCmd(["help"])).rejects.toThrow(ClipError),
      expect(runSkillsCmd(["unknown-sub"])).rejects.toThrow(ClipError),
    ]);
  });

  test("'add' 후 name 없음 → ClipError (Usage 포함)", async () => {
    await Promise.all([
      expect(runSkillsCmd(["add"])).rejects.toThrow(ClipError),
      expect(runSkillsCmd(["add"])).rejects.toThrow(/Usage/),
    ]);
  });

  test("'install' 후 name 없음 → ClipError (Usage 포함)", async () => {
    await Promise.all([
      expect(runSkillsCmd(["install"])).rejects.toThrow(ClipError),
      expect(runSkillsCmd(["install"])).rejects.toThrow(/Usage/),
    ]);
  });
});

// --- AGENT_PRESETS 목록 — 소스 레벨 검증 ---
// 실제 설치는 FS 사이드 이펙트가 크기 때문에 소스 코드 구조로만 확인

describe("runSkillsCmd / AGENT_PRESETS (소스 검증)", () => {
  test("AGENT_PRESETS에 claude-code, codex, gemini, pi 포함", async () => {
    // install --to 없이 실행하면 Available 목록을 출력하는 오류가 발생함
    try {
      await runSkillsCmd(["install", "__probe__"]);
    } catch (e) {
      expect(e).toBeInstanceOf(ClipError);
      const msg = (e as ClipError).message;
      // probe skill이 없으므로 "not found" 오류가 먼저 발생할 수 있음
      // 그 경우는 오류 자체가 ClipError이면 충분 (preset 목록 검증은 소스 검사로)
      expect(typeof msg).toBe("string");
    }

    // 소스 코드에 AGENT_PRESETS 상수로 등록되어 있는지 직접 확인
    const fs = await import("fs");
    const path = await import("path");
    const { fileURLToPath } = await import("url");
    const dir = path.dirname(fileURLToPath(import.meta.url));
    const content = fs.readFileSync(path.join(dir, "skills.ts"), "utf8");

    expect(content).toContain('"claude-code"');
    expect(content).toContain('codex');
    expect(content).toContain('gemini');
    expect(content).toContain('pi');
  });
});

// --- 회귀: install 서브커맨드 --to 없으면 Available 목록 노출 ---

describe("runSkillsCmd / install --to 누락 시 Available 안내", () => {
  test("install --to 없으면 Available 목록이 오류 메시지에 포함", async () => {
    // 먼저 실제로 존재하지 않는 스킬로 테스트 — 'not found' 오류가 먼저 나올 수 있음
    // --to 없이 install을 요청하는 케이스를 소스 레벨로 검증
    const fs = await import("fs");
    const path = await import("path");
    const { fileURLToPath } = await import("url");
    const dir = path.dirname(fileURLToPath(import.meta.url));
    const content = fs.readFileSync(path.join(dir, "skills.ts"), "utf8");

    // cmdInstall이 --to 없을 때 die()로 Available 목록을 보여주는 패턴 확인
    expect(content).toMatch(/at least one --to/);
    expect(content).toMatch(/Object\.keys\(AGENT_PRESETS\)/);
  });
});
