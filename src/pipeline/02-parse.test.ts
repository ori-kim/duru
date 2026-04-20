import { describe, expect, test } from "bun:test";
import { createRawInvocation } from "./01-raw.ts";
import { parseInvocation } from "./02-parse.ts";

type P = {
  argv: readonly string[];
  token: string | undefined;
  baseName: string | undefined;
  explicitProfile: string | undefined;
  userArgs: readonly string[];
  lateFlags: { jsonMode: boolean; pipeMode: boolean; dryRun: boolean };
  configPath: string | undefined;
  internalVerb: string | undefined;
};

function parse(args: string[], env: Record<string, string> = {}): P {
  const raw = createRawInvocation(args, env);
  return parseInvocation(raw) as unknown as P;
}

// --- 빈 argv ---

describe("empty argv", () => {
  test("returns empty with no verb", () => {
    const p = parse([]);
    expect(p.internalVerb).toBeUndefined();
    expect(p.token).toBeUndefined();
    expect(p.baseName).toBeUndefined();
    expect(p.userArgs).toEqual([]);
  });
});

// --- global flags (전/후/중간/섞임) ---

describe("global flags", () => {
  test("--json before target", () => {
    const p = parse(["--json", "slack", "list"]);
    expect(p.lateFlags.jsonMode).toBe(true);
    expect(p.baseName).toBe("slack");
    expect(p.userArgs).toEqual(["list"]);
  });

  test("--pipe before target", () => {
    const p = parse(["--pipe", "slack", "list"]);
    expect(p.lateFlags.pipeMode).toBe(true);
    expect(p.baseName).toBe("slack");
  });

  test("--dry-run before target", () => {
    const p = parse(["--dry-run", "slack", "run"]);
    expect(p.lateFlags.dryRun).toBe(true);
    expect(p.baseName).toBe("slack");
  });

  test("multiple global flags combined", () => {
    const p = parse(["--json", "--pipe", "--dry-run", "slack", "list"]);
    expect(p.lateFlags).toEqual({ jsonMode: true, pipeMode: true, dryRun: true });
    expect(p.baseName).toBe("slack");
  });

  test("--config sets configPath", () => {
    const p = parse(["--config", "/my/config.yml", "slack", "list"]);
    expect(p.configPath).toBe("/my/config.yml");
    expect(p.baseName).toBe("slack");
  });

  test("-c short alias for --config", () => {
    const p = parse(["-c", "/my/config.yml", "slack", "list"]);
    expect(p.configPath).toBe("/my/config.yml");
  });
});

// --- --help / --version 처리 ---

describe("--help and --version", () => {
  test("standalone --help → internalVerb=help", () => {
    const p = parse(["--help"]);
    expect(p.internalVerb).toBe("help");
    expect(p.token).toBeUndefined();
  });

  test("-h → internalVerb=help", () => {
    const p = parse(["-h"]);
    expect(p.internalVerb).toBe("help");
  });

  test("--version → internalVerb=version", () => {
    const p = parse(["--version"]);
    expect(p.internalVerb).toBe("version");
  });

  test("-v → internalVerb=version", () => {
    const p = parse(["-v"]);
    expect(p.internalVerb).toBe("version");
  });
});

// --- @profile 분리 ---

describe("@profile split", () => {
  test("name@profile", () => {
    const p = parse(["slack@bot", "chat.postMessage"]);
    expect(p.token).toBe("slack@bot");
    expect(p.baseName).toBe("slack");
    expect(p.explicitProfile).toBe("bot");
    expect(p.userArgs).toEqual(["chat.postMessage"]);
  });

  test("name@ (empty profile string)", () => {
    const p = parse(["slack@", "list"]);
    expect(p.baseName).toBe("slack");
    expect(p.explicitProfile).toBe("");
  });

  test("@profile only (empty baseName)", () => {
    const p = parse(["@bot"]);
    expect(p.baseName).toBe("");
    expect(p.explicitProfile).toBe("bot");
  });

  test("name without @ has no profile", () => {
    const p = parse(["slack", "list"]);
    expect(p.baseName).toBe("slack");
    expect(p.explicitProfile).toBeUndefined();
  });

  test("name@profile@extra — first @ wins", () => {
    const p = parse(["slack@bot@extra"]);
    expect(p.baseName).toBe("slack");
    expect(p.explicitProfile).toBe("bot@extra");
  });

  test("global flags + @profile", () => {
    const p = parse(["--json", "slack@bot", "tools"]);
    expect(p.lateFlags.jsonMode).toBe(true);
    expect(p.baseName).toBe("slack");
    expect(p.explicitProfile).toBe("bot");
    expect(p.userArgs).toEqual(["tools"]);
  });
});

// --- LATE_FLAGS 필터링 ---

describe("late flags in target args", () => {
  test("--json in target args merged", () => {
    const p = parse(["slack", "list", "--json"]);
    expect(p.lateFlags.jsonMode).toBe(true);
    expect(p.userArgs).toEqual(["list"]);
  });

  test("--pipe in target args merged", () => {
    const p = parse(["slack", "list", "--pipe"]);
    expect(p.lateFlags.pipeMode).toBe(true);
    expect(p.userArgs).toEqual(["list"]);
  });

  test("--dry-run in target args merged", () => {
    const p = parse(["slack", "run", "--dry-run"]);
    expect(p.lateFlags.dryRun).toBe(true);
    expect(p.userArgs).toEqual(["run"]);
  });

  test("late flags removed from userArgs", () => {
    const p = parse(["slack", "tools", "--json", "--pipe"]);
    expect(p.lateFlags.jsonMode).toBe(true);
    expect(p.lateFlags.pipeMode).toBe(true);
    expect(p.userArgs).toEqual(["tools"]);
  });

  test("global --json OR'd with late --json", () => {
    const p = parse(["--json", "slack", "list", "--json"]);
    expect(p.lateFlags.jsonMode).toBe(true);
    expect(p.userArgs).toEqual(["list"]);
  });

  test("non-late flags not removed", () => {
    const p = parse(["slack", "tools", "--format", "json"]);
    expect(p.userArgs).toEqual(["tools", "--format", "json"]);
  });

  test("--help in target args NOT removed (not a late flag)", () => {
    const p = parse(["slack", "chat.postMessage", "--help"]);
    expect(p.userArgs).toEqual(["chat.postMessage", "--help"]);
  });
});

// --- internal verb 경로 ---

describe("internal verbs", () => {
  test("list", () => {
    const p = parse(["list"]);
    expect(p.internalVerb).toBe("list");
    expect(p.userArgs).toEqual([]);
  });

  test("add cli foo", () => {
    const p = parse(["add", "cli", "foo"]);
    expect(p.internalVerb).toBe("add");
    expect(p.userArgs).toEqual(["cli", "foo"]);
  });

  test("remove foo", () => {
    const p = parse(["remove", "foo"]);
    expect(p.internalVerb).toBe("remove");
    expect(p.userArgs).toEqual(["foo"]);
  });

  test("profile list slack", () => {
    const p = parse(["profile", "list", "slack"]);
    expect(p.internalVerb).toBe("profile");
    expect(p.userArgs).toEqual(["list", "slack"]);
  });

  test("bind slack", () => {
    const p = parse(["bind", "slack"]);
    expect(p.internalVerb).toBe("bind");
    expect(p.userArgs).toEqual(["slack"]);
  });

  test("completion bash", () => {
    const p = parse(["completion", "bash"]);
    expect(p.internalVerb).toBe("completion");
    expect(p.userArgs).toEqual(["bash"]);
  });

  test("skills subcommand", () => {
    const p = parse(["skills", "list"]);
    expect(p.internalVerb).toBe("skills");
    expect(p.userArgs).toEqual(["list"]);
  });

  test("config with global flag before it", () => {
    const p = parse(["--json", "config"]);
    expect(p.internalVerb).toBe("config");
    expect(p.lateFlags.jsonMode).toBe(true);
  });
});

// --- --help <tool> 재배치는 matchCommand 책임 (parse에서는 그대로 통과) ---

describe("--help in target args passthrough", () => {
  test("foo --help mytool remains in userArgs", () => {
    const p = parse(["foo", "--help", "mytool"]);
    expect(p.baseName).toBe("foo");
    expect(p.userArgs).toEqual(["--help", "mytool"]);
  });

  test("foo -h mytool --json: -h remains, --json filtered", () => {
    const p = parse(["foo", "-h", "mytool", "--json"]);
    expect(p.lateFlags.jsonMode).toBe(true);
    expect(p.userArgs).toEqual(["-h", "mytool"]);
  });
});
