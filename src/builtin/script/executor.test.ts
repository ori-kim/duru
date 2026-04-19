import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { ClipError } from "../../utils/errors.ts";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { ExecutorContext } from "../../extension.ts";
import { executeScript } from "./executor.ts";
import type { ScriptTarget } from "./schema.ts";

// --- helpers ---

function makeTarget(commands: ScriptTarget["commands"], extra: Partial<ScriptTarget> = {}): ScriptTarget {
  return { commands: commands ?? {}, ...extra };
}

function ctx(subcommand: string, args: string[] = [], dryRun = false, passthrough = false): ExecutorContext {
  return { subcommand, args, dryRun, passthrough, headers: {}, targetName: "", jsonMode: false };
}

// --- tools 출력 ---

describe("executeScript / tools", () => {
  test("commands 없음 → No commands defined", async () => {
    const r = await executeScript(makeTarget({}), ctx("tools"));
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("No commands defined.");
  });

  test("commands 알파벳순 정렬", async () => {
    const r = await executeScript(
      makeTarget({
        z: { script: "echo z" },
        a: { script: "echo a" },
        m: { script: "echo m" },
      }),
      ctx("tools"),
    );
    const names = r.stdout
      .split("\n")
      .filter((l) => l.startsWith("  "))
      .map((l) => l.trim().split(/\s+/)[0]);
    expect(names).toEqual(["a", "m", "z"]);
  });

  test("description 출력", async () => {
    const r = await executeScript(
      makeTarget({
        run: { script: "echo hi", description: "runs things" },
      }),
      ctx("tools"),
    );
    expect(r.stdout).toContain("runs things");
  });

  test("args 목록 출력", async () => {
    const r = await executeScript(
      makeTarget({
        greet: { script: 'echo "$1"', args: ["name"] },
      }),
      ctx("tools"),
    );
    expect(r.stdout).toContain("<name>");
  });

  test("file 명령은 [file] 마커 표시", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "clip-test-"));
    try {
      const sh = join(tmp, "hello.sh");
      writeFileSync(sh, "#!/bin/sh\necho hi\n");
      chmodSync(sh, 0o755);
      const r = await executeScript(
        makeTarget({
          hello: { file: sh },
        }),
        ctx("tools"),
      );
      expect(r.stdout).toContain("[file]");
    } finally {
      rmSync(tmp, { recursive: true });
    }
  });

  test("aliases 섹션 공존", async () => {
    const r = await executeScript(
      makeTarget({ lag: { script: "echo lag" } }, { aliases: { l: { subcommand: "lag" } } }),
      ctx("tools"),
    );
    expect(r.stdout).toContain("Aliases:");
    expect(r.stdout).toContain("l");
  });
});

// --- inline script 실행 ---

describe("executeScript / inline script", () => {
  test("positional: $1 $2", async () => {
    const r = await executeScript(
      makeTarget({
        greet: { script: 'echo "$1 $2"' },
      }),
      ctx("greet", ["hello", "world"]),
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe("hello world");
  });

  test("$@ spread — 공백 포함 인자 보존", async () => {
    const r = await executeScript(
      makeTarget({
        print: { script: 'printf "%s\\n" "$@"' },
      }),
      ctx("print", ["x", "y z", "w"]),
    );
    expect(r.exitCode).toBe(0);
    const lines = r.stdout.trim().split("\n");
    expect(lines).toEqual(["x", "y z", "w"]);
  });

  test("인자 주입 방지 — 세미콜론이 명령으로 해석되지 않고 리터럴로 출력", async () => {
    const r = await executeScript(
      makeTarget({
        echo: { script: 'echo "$1"' },
      }),
      ctx("echo", [";echo INJECTED"]),
    );
    const lines = r.stdout.split("\n").filter((l) => l.length > 0);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe(";echo INJECTED");
  });

  test("exit code 전달", async () => {
    const r = await executeScript(
      makeTarget({
        fail: { script: "exit 42" },
      }),
      ctx("fail"),
    );
    expect(r.exitCode).toBe(42);
  });

  test("env 병합 우선순위: def.env 최우선", async () => {
    const r = await executeScript(
      makeTarget(
        { show: { script: 'echo "$MY_VAR"', env: { MY_VAR: "from-def" } } },
        { env: { MY_VAR: "from-target" } },
      ),
      ctx("show"),
    );
    expect(r.stdout.trim()).toBe("from-def");
  });

  test("env 병합 우선순위: target.env가 process.env보다 우선", async () => {
    process.env["CLIP_TEST_VAR"] = "from-process";
    try {
      const r = await executeScript(
        makeTarget({ show: { script: 'echo "$CLIP_TEST_VAR"' } }, { env: { CLIP_TEST_VAR: "from-target" } }),
        ctx("show"),
      );
      expect(r.stdout.trim()).toBe("from-target");
    } finally {
      delete process.env["CLIP_TEST_VAR"];
    }
  });
});

// --- file 모드 ---

describe("executeScript / file mode", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "clip-test-"));
  });
  afterEach(() => rmSync(tmp, { recursive: true }));

  function writeScript(name: string, content: string): string {
    const p = join(tmp, name);
    writeFileSync(p, content);
    chmodSync(p, 0o755);
    return p;
  }

  test("절대경로 실행", async () => {
    const sh = writeScript("hello.sh", "#!/bin/sh\necho 'hi $1'\necho \"$1\"\n");
    const r = await executeScript(makeTarget({ hello: { file: sh } }), ctx("hello", ["world"]));
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("world");
  });

  test("인자 전달", async () => {
    const sh = writeScript("args.sh", '#!/bin/sh\necho "$1"\necho "$2"\n');
    const r = await executeScript(makeTarget({ run: { file: sh } }), ctx("run", ["a", "b"]));
    expect(r.stdout.trim()).toBe("a\nb");
  });

  test("파일 없음 → ClipError에 not found 포함", async () => {
    await expect(
      executeScript(makeTarget({ run: { file: join(tmp, "nonexistent.sh") } }), ctx("run")),
    ).rejects.toThrow(ClipError);
    await expect(
      executeScript(makeTarget({ run: { file: join(tmp, "nonexistent.sh") } }), ctx("run")),
    ).rejects.toThrow(/not found/i);
  });

  test("실행권한 없음 → ClipError에 executable + chmod 힌트 포함", async () => {
    const p = join(tmp, "noperm.sh");
    writeFileSync(p, "#!/bin/sh\necho hi\n");
    chmodSync(p, 0o644);
    await expect(executeScript(makeTarget({ run: { file: p } }), ctx("run"))).rejects.toThrow(ClipError);
    await expect(executeScript(makeTarget({ run: { file: p } }), ctx("run"))).rejects.toThrow(/executable/i);
  });
});

// --- unknown command ---

describe("executeScript / unknown command", () => {
  test("없는 command → ClipError에 Unknown command 포함", async () => {
    await expect(executeScript(makeTarget({}), ctx("notexist"))).rejects.toThrow(ClipError);
    await expect(executeScript(makeTarget({}), ctx("notexist"))).rejects.toThrow(/Unknown command/i);
  });
});

// --- --help ---

describe("executeScript / --help", () => {
  test("description + args 출력", async () => {
    const r = await executeScript(
      makeTarget({
        greet: { script: 'echo "$1"', description: "say hello", args: ["name"] },
      }),
      ctx("greet", ["--help"]),
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("say hello");
    expect(r.stdout).toContain("name");
  });

  test("file 명령 help에 파일 경로 표시", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "clip-test-help-"));
    try {
      const sh = join(tmp, "script.sh");
      writeFileSync(sh, "#!/bin/sh\necho hi\n");
      chmodSync(sh, 0o755);
      const r = await executeScript(
        makeTarget({
          run: { file: sh, description: "runs the script" },
        }),
        ctx("run", ["-h"]),
      );
      expect(r.stdout).toContain(sh);
    } finally {
      rmSync(tmp, { recursive: true });
    }
  });
});

// --- dryRun ---

describe("executeScript / dryRun", () => {
  test("inline script → script 미리보기, spawn 안 함", async () => {
    const r = await executeScript(
      makeTarget({
        deploy: { script: "echo deploying" },
      }),
      ctx("deploy", ["arg1"], true),
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("# script:");
    expect(r.stdout).toContain("echo deploying");
    expect(r.stdout).toContain('"arg1"');
  });

  test("file → 경로 + args 미리보기", async () => {
    const tmp2 = mkdtempSync(join(tmpdir(), "clip-test-dry-"));
    try {
      const sh = join(tmp2, "deploy.sh");
      writeFileSync(sh, "#!/bin/sh\necho hi\n");
      chmodSync(sh, 0o755);
      const r = await executeScript(
        makeTarget({
          deploy: { file: sh },
        }),
        ctx("deploy", ["a", "b"], true),
      );
      expect(r.stdout).toContain("# file:");
      expect(r.stdout).toContain(sh);
      expect(r.stdout).toContain('"a"');
    } finally {
      rmSync(tmp2, { recursive: true });
    }
  });
});

// --- tools subcommand — tools 예약어 동작 확인 ---

describe("executeScript / tools is reserved", () => {
  test("tools 서브커맨드는 항상 목록 출력", async () => {
    const r = await executeScript(makeTarget({ run: { script: "echo hi" } }), ctx("tools"));
    expect(r.stdout).toContain("Commands:");
    expect(r.stdout).toContain("run");
  });
});
