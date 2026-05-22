import { describe, expect, test } from "bun:test";
import { createAppCli } from "./app.ts";

describe("clip-cli demo app", () => {
  test("renders text output by default", async () => {
    const result = await createAppCli().run(["hello", "example", "--uppercase"]);

    expect(result.exitCode).toBe(0);
    expect(result.rendered?.stdout).toBe("hello EXAMPLE\n");
  });

  test("can render command output as json", async () => {
    const result = await createAppCli().run(["inspect", "--json"]);

    expect(result.exitCode).toBe(0);
    expect(result.rendered?.stdout).toContain('"app": "clip-cli"');
  });

  test("renders command json presenters without output envelopes", async () => {
    const result = await createAppCli().run(["hello", "example", "--json"]);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.rendered?.stdout ?? "")).toEqual({ greeting: "hello example" });
  });

  test("runs nested router commands", async () => {
    const result = await createAppCli().run(["ext", "registry", "add", "example"]);

    expect(result.exitCode).toBe(0);
    expect(result.value).toEqual({ registry: "example", status: "added" });
  });

  test("runs custom event observer demo", async () => {
    const result = await createAppCli().run(["events", "--json", "--events"]);

    expect(result.exitCode).toBe(0);
    expect(result.value).toEqual({ observed: "event observer ran" });
    expect(JSON.parse(result.rendered?.stdout ?? "")).toEqual({
      result: { observed: "event observer ran" },
      events: [{ name: "log", payload: { message: "event observer ran" } }],
    });
  });

  test("uses notFound observer output", async () => {
    const result = await createAppCli().run(["missing", "--json"]);

    expect(result.exitCode).toBe(1);
    expect(result.value).toEqual({
      error: { message: "Unknown command: missing --json" },
      hint: "Run clip --help",
    });
  });

  test("uses catch handler output", async () => {
    const result = await createAppCli().run(["fail", "--json"]);

    expect(result.exitCode).toBe(1);
    expect(result.value).toEqual({
      error: { message: "demo failure" },
      hint: "The catch handler converted this failure",
    });
  });

  test("runs zod-backed command input examples", async () => {
    const result = await createAppCli().run(["call", "42", "--timeout-ms", "1500", "--dry-run"], { render: false });

    expect(result.exitCode).toBe(0);
    expect(result.result).toEqual({ operation: 42, timeoutMs: 1500, dryRun: true });
  });

  test("runs command metadata alias examples", async () => {
    const result = await createAppCli().run(["meta", "pub", "notes"], { render: false });

    expect(result.exitCode).toBe(0);
    expect(result.result).toEqual({ name: "notes", status: "published", dryRun: false });
  });

  test("runs explicit mount and partial path middleware examples", async () => {
    const result = await createAppCli().run(["tools", "echo", "hello"], { render: false });

    expect(result.exitCode).toBe(0);
    expect(result.result).toEqual({ value: "hello" });
    expect(result.events).toEqual([{ name: "log", payload: { message: "tools subtree", path: "tools echo hello" } }]);
  });

  test("runs route-level error boundary examples", async () => {
    const result = await createAppCli().run(["tools", "fail"], { render: false });

    expect(result.exitCode).toBe(4);
    expect(result.result).toEqual({ handledBy: "tools", message: "tool failure" });
  });

  test("runs command-level error boundary examples", async () => {
    const result = await createAppCli().run(["tools", "recover"], { render: false });

    expect(result.exitCode).toBe(3);
    expect(result.result).toEqual({ handledBy: "command", message: "recoverable failure" });
  });
});
