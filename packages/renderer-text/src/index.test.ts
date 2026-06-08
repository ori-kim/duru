import { describe, expect, test } from "bun:test";
import { withRenderHint } from "@duru/cli-kit";
import { textRenderer } from "./index.ts";

describe("text renderer", () => {
  test("prepends table text when a table result includes text", async () => {
    const value = withRenderHint(
      {
        text: "searched paths: /tmp/agent-skills",
        rows: [{ name: "duru-writer", skill: "writer" }],
      },
      "table",
    );

    const rendered = await textRenderer().render({ result: value, value, events: [], format: "text" }, {
      options: {},
      params: {},
      request: {},
      io: {},
    } as never);

    expect(rendered.stdout).toBe("searched paths: /tmp/agent-skills\nname         skill\nduru-writer  writer\n");
  });
});
