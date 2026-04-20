import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { RESERVED_WORKSPACE_NAMES, WORKSPACE_FILE } from "../config.ts";
import { ClipError } from "../utils/errors.ts";
import { runWorkspaceCmd } from "./workspace.ts";

// --- RESERVED_WORKSPACE_NAMES ---

describe("RESERVED_WORKSPACE_NAMES", () => {
  test("contains filesystem-level reserved dirs", () => {
    for (const name of ["target", "bin", "extensions", "hooks"]) {
      expect(RESERVED_WORKSPACE_NAMES.has(name)).toBe(true);
    }
  });

  test("does not contain arbitrary names", () => {
    expect(RESERVED_WORKSPACE_NAMES.has("myworkspace")).toBe(false);
    expect(RESERVED_WORKSPACE_NAMES.has("prod")).toBe(false);
  });
});

// --- workspace new — 이름 검증 (파일 I/O 없음) ---

describe("runWorkspaceCmd / new — validation", () => {
  test("이름 없음 → ClipError (Usage 포함)", async () => {
    await Promise.all([
      expect(runWorkspaceCmd(["new"])).rejects.toThrow(ClipError),
      expect(runWorkspaceCmd(["new"])).rejects.toThrow(/Usage/),
    ]);
  });

  test("빈 문자열 이름 → ClipError", () =>
    expect(runWorkspaceCmd(["new", ""])).rejects.toThrow(ClipError));

  test("reserved name 'target' → ClipError (reserved 포함)", async () => {
    await Promise.all([
      expect(runWorkspaceCmd(["new", "target"])).rejects.toThrow(ClipError),
      expect(runWorkspaceCmd(["new", "target"])).rejects.toThrow(/reserved/),
    ]);
  });

  test("reserved name 'bin' → ClipError", () =>
    expect(runWorkspaceCmd(["new", "bin"])).rejects.toThrow(ClipError));

  test("reserved name 'extensions' → ClipError", () =>
    expect(runWorkspaceCmd(["new", "extensions"])).rejects.toThrow(ClipError));

  test("reserved name 'hooks' → ClipError", () =>
    expect(runWorkspaceCmd(["new", "hooks"])).rejects.toThrow(ClipError));

  test("'.' 시작 이름 → ClipError", async () => {
    await Promise.all([
      expect(runWorkspaceCmd(["new", ".hidden"])).rejects.toThrow(ClipError),
      expect(runWorkspaceCmd(["new", ".hidden"])).rejects.toThrow(/\./),
    ]);
  });

  test("점(.) 포함 이름 → ClipError (invalid chars)", async () => {
    await Promise.all([
      expect(runWorkspaceCmd(["new", "my.workspace"])).rejects.toThrow(ClipError),
      expect(runWorkspaceCmd(["new", "my.workspace"])).rejects.toThrow(/letters, digits/),
    ]);
  });

  test("슬래시(/) 포함 이름 → ClipError", () =>
    expect(runWorkspaceCmd(["new", "foo/bar"])).rejects.toThrow(ClipError));

  test("공백 포함 이름 → ClipError", () =>
    expect(runWorkspaceCmd(["new", "my workspace"])).rejects.toThrow(ClipError));

  test("특수문자(@) 포함 이름 → ClipError", () =>
    expect(runWorkspaceCmd(["new", "my@ws"])).rejects.toThrow(ClipError));

  test("유효한 이름 형식 (알파벳, 숫자, _, -)은 정규식 통과", () => {
    // 실제 workspace를 생성하지 않고 정규식만 검증
    const regex = /^[a-zA-Z0-9_-]+$/;
    expect(regex.test("valid-name_123")).toBe(true);
    expect(regex.test("my-workspace")).toBe(true);
    expect(regex.test("ws1")).toBe(true);
    expect(regex.test("PROD")).toBe(true);
  });

  test("'-' 이름 → ClipError (sentinel reserved)", () =>
    expect(runWorkspaceCmd(["new", "-"])).rejects.toThrow(ClipError));

  test("'--none' 이름 → ClipError (sentinel reserved)", () =>
    expect(runWorkspaceCmd(["new", "--none"])).rejects.toThrow(ClipError));
});

// --- workspace use — 이름 검증 (파일 I/O 최소) ---

describe("runWorkspaceCmd / use — validation", () => {
  test("이름 없음 → ClipError (Usage 포함)", async () => {
    await Promise.all([
      expect(runWorkspaceCmd(["use"])).rejects.toThrow(ClipError),
      expect(runWorkspaceCmd(["use"])).rejects.toThrow(/Usage/),
    ]);
  });

  test("reserved name → ClipError", async () => {
    await Promise.all([
      expect(runWorkspaceCmd(["use", "target"])).rejects.toThrow(ClipError),
      expect(runWorkspaceCmd(["use", "target"])).rejects.toThrow(/reserved/),
    ]);
  });

  test("'.' 시작 이름 → ClipError", () =>
    expect(runWorkspaceCmd(["use", ".hidden"])).rejects.toThrow(ClipError));

  test("invalid chars → ClipError", async () => {
    await Promise.all([
      expect(runWorkspaceCmd(["use", "my.ws"])).rejects.toThrow(ClipError),
      expect(runWorkspaceCmd(["use", "my workspace"])).rejects.toThrow(ClipError),
    ]);
  });

  test("존재하지 않는 workspace → ClipError (does not exist 포함)", async () => {
    await Promise.all([
      expect(runWorkspaceCmd(["use", "xyzzy-no-such-workspace-test-9999"])).rejects.toThrow(ClipError),
      expect(runWorkspaceCmd(["use", "xyzzy-no-such-workspace-test-9999"])).rejects.toThrow(/does not exist/),
    ]);
  });
});

// --- workspace remove — 이름 검증 ---

describe("runWorkspaceCmd / remove — validation", () => {
  test("이름 없음 → ClipError (Usage 포함)", async () => {
    await Promise.all([
      expect(runWorkspaceCmd(["remove"])).rejects.toThrow(ClipError),
      expect(runWorkspaceCmd(["remove"])).rejects.toThrow(/Usage/),
    ]);
  });

  test("'--force' 단독 인자 (이름으로 오해 불가) → ClipError (Usage 포함)", async () => {
    await Promise.all([
      expect(runWorkspaceCmd(["remove", "--force"])).rejects.toThrow(ClipError),
      expect(runWorkspaceCmd(["remove", "--force"])).rejects.toThrow(/Usage/),
    ]);
  });

  test("'--other' 같은 -- 시작 이름 → ClipError", () =>
    expect(runWorkspaceCmd(["remove", "--other"])).rejects.toThrow(ClipError));

  test("reserved name → ClipError", () =>
    expect(runWorkspaceCmd(["remove", "bin"])).rejects.toThrow(ClipError));

  test("'.' 시작 이름 → ClipError", () =>
    expect(runWorkspaceCmd(["remove", ".hidden"])).rejects.toThrow(ClipError));

  test("invalid chars → ClipError", () =>
    expect(runWorkspaceCmd(["remove", "my.ws"])).rejects.toThrow(ClipError));

  test("존재하지 않는 workspace → ClipError", () =>
    expect(runWorkspaceCmd(["remove", "xyzzy-no-such-workspace-test-8888"])).rejects.toThrow(ClipError));
});

// --- workspace list — 읽기 전용, 오류 없음 ---

describe("runWorkspaceCmd / list", () => {
  test("오류 없이 완료", () => expect(runWorkspaceCmd(["list"])).resolves.toBeUndefined());
});

// --- workspace (인자 없음) --- 읽기 전용 ---

describe("runWorkspaceCmd / no args", () => {
  test("오류 없이 완료", () => expect(runWorkspaceCmd([])).resolves.toBeUndefined());
});

// --- unknown subcommand ---

describe("runWorkspaceCmd / unknown subcommand", () => {
  test("모르는 subcommand → ClipError (Unknown workspace subcommand 포함)", async () => {
    await Promise.all([
      expect(runWorkspaceCmd(["foobar"])).rejects.toThrow(ClipError),
      expect(runWorkspaceCmd(["foobar"])).rejects.toThrow(/Unknown workspace subcommand/),
    ]);
  });

  test("'create' (not 'new') → ClipError", () =>
    expect(runWorkspaceCmd(["create", "myws"])).rejects.toThrow(ClipError));

  test("'switch' (not 'use') → ClipError", () =>
    expect(runWorkspaceCmd(["switch", "myws"])).rejects.toThrow(ClipError));

  test("'delete' (not 'remove') → ClipError", () =>
    expect(runWorkspaceCmd(["delete", "myws"])).rejects.toThrow(ClipError));
});

// --- sentinel clear flow ---

describe("runWorkspaceCmd / sentinel clear flow", () => {
  let savedContent: string | null = null;

  beforeEach(() => {
    savedContent = existsSync(WORKSPACE_FILE) ? readFileSync(WORKSPACE_FILE, "utf8") : null;
  });

  afterEach(async () => {
    if (savedContent === null) {
      await Bun.spawn(["rm", "-f", WORKSPACE_FILE]).exited;
    } else {
      writeFileSync(WORKSPACE_FILE, savedContent);
    }
  });

  test("'workspace use -' → WORKSPACE_FILE 초기화, ClipError 없음", async () => {
    const result = await runWorkspaceCmd(["use", "-"]).catch((e) => e);
    expect(result).toBeUndefined();
  });
});
