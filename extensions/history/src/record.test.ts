import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CommandHookCtx } from "@clip/core";
import {
  type HistoryRecord,
  appendHistoryRecord,
  historyDir,
  queryHistory,
  recordCliEnd,
  redactArgv,
  summarizeHistoryRecord,
} from "./record.ts";

function tempHome(): string {
  return mkdtempSync(join(tmpdir(), "clip-history-"));
}

function record(id: string, ts: string, exitCode: number, target = "catservice"): HistoryRecord {
  return {
    schemaVersion: 1,
    id,
    ts,
    process: {
      pid: 1,
      ppid: 0,
      cwd: "/workspace",
      stdinTTY: false,
      stdoutTTY: false,
      stderrTTY: false,
    },
    command: {
      kind: "target",
      argv: [target, "list-cats"],
      token: target,
      target,
      targetType: "api",
      subcommand: "list-cats",
      args: [],
      dryRun: false,
      jsonMode: false,
      pipeMode: false,
    },
    result: { exitCode, durationMs: 12 },
  };
}

describe("history records", () => {
  test("redacts sensitive-looking argv values without redacting normal flags", () => {
    const result = redactArgv([
      "catservice",
      "list-cats",
      "--token",
      "dummy-token",
      "--api-key=dummy-api-key",
      "--author",
      "@me",
      "Authorization=Bearer dummy-token-value",
    ]);

    expect(result.argv).toEqual([
      "catservice",
      "list-cats",
      "--token",
      "[REDACTED]",
      "--api-key=[REDACTED]",
      "--author",
      "@me",
      "Authorization=[REDACTED]",
    ]);
    expect(result.redactions).toBe(3);
  });

  test("writes daily JSONL partitions and queries with limit, offset, and filters", () => {
    const home = tempHome();
    appendHistoryRecord(record("old", "2026-05-07T01:00:00.000Z", 0), home);
    appendHistoryRecord(record("failed", "2026-05-08T01:00:00.000Z", 2, "notes-api"), home);
    appendHistoryRecord(record("new", "2026-05-08T02:00:00.000Z", 0), home);

    expect(historyDir(home)).toContain("history");

    const firstPage = queryHistory({ limit: 1 }, home);
    expect(firstPage.total).toBe(3);
    expect(firstPage.records.map((item) => item.id)).toEqual(["new"]);

    const secondPage = queryHistory({ limit: 1, offset: 1 }, home);
    expect(secondPage.records.map((item) => item.id)).toEqual(["failed"]);

    const failed = queryHistory({ status: "failed" }, home);
    expect(failed.records.map((item) => item.id)).toEqual(["failed"]);

    const target = queryHistory({ target: "catservice" }, home);
    expect(target.records.map((item) => item.id)).toEqual(["new", "old"]);
  });

  test("command-end recorder skips clip history commands and records target result byte counts", () => {
    const home = tempHome();

    recordCliEnd(
      {
        phase: "command-end",
        argv: ["history", "list"],
        startedAt: "2026-05-08T04:00:00.000Z",
        durationMs: 3,
        exitCode: 0,
        command: { kind: "command", argv: ["history", "list"], name: "history", args: ["list"] },
      },
      home,
    );
    expect(queryHistory({}, home).records).toEqual([]);

    const ctx: CommandHookCtx = {
      phase: "command-end",
      argv: ["catservice", "list-cats", "--json"],
      startedAt: "2026-05-08T05:00:00.000Z",
      durationMs: 9,
      exitCode: 0,
      command: {
        kind: "target",
        argv: ["catservice", "list-cats", "--json"],
        token: "catservice",
        target: "catservice",
        targetType: "api",
        subcommand: "list-cats",
        args: ["--json"],
        dryRun: false,
        jsonMode: true,
        pipeMode: false,
      },
      result: { exitCode: 0, stdout: '{"ok":true}', stderr: "" },
    };
    recordCliEnd(ctx, home);

    const records = queryHistory({}, home).records;
    expect(records).toHaveLength(1);
    expect(records[0]?.command.kind).toBe("target");
    expect(records[0]?.result.stdoutBytes).toBe(11);
    expect(records[0]?.result.stderrBytes).toBe(0);
  });

  test("summarizes large JSON args without expanding payload values", () => {
    const summary = summarizeHistoryRecord({
      ...record("json-args", "2026-05-08T03:00:00.000Z", 0),
      command: {
        kind: "target",
        argv: [
          "catservice",
          "update-cat",
          "--args",
          '{"cat_id":"cat-1","name":"Navi","url":"https://catservice.example.com/very/long/path"}',
          "--json",
        ],
        token: "catservice",
        target: "catservice",
        targetType: "api",
        subcommand: "update-cat",
        args: ["--args", '{"cat_id":"cat-1","name":"Navi","url":"https://catservice.example.com/very/long/path"}'],
        dryRun: false,
        jsonMode: true,
        pipeMode: false,
      },
    });

    expect(summary.target).toBe("api/catservice");
    expect(summary.action).toBe("update-cat");
    expect(summary.command).toBe("clip catservice update-cat");
    expect(summary.args).toContain("--args {cat_id,name,url}");
    expect(summary.args).not.toContain("https://catservice.example.com");
  });
});
