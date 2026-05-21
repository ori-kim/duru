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
});
