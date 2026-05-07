import { describe, expect, test } from "bun:test";
import { collectStdioCommandArgs } from "./extension.ts";

describe("MCP add STDIO args", () => {
  test("preserves unknown long flags as server command args", () => {
    expect(
      collectStdioCommandArgs(
        ["/Applications/Pencil.app/Contents/Resources/app.asar.unpacked/out/mcp-server-darwin-arm64"],
        { stdio: "true", app: "desktop" },
      ),
    ).toEqual(["--app", "desktop"]);
  });

  test("keeps positional args and appends unknown flags", () => {
    expect(collectStdioCommandArgs(["npx", "-y", "server"], { stdio: "true", scope: "repo" })).toEqual([
      "-y",
      "server",
      "--scope",
      "repo",
    ]);
  });
});
