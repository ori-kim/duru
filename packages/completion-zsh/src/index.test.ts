import { describe, expect, test } from "bun:test";
import { renderZshCompletion, zshDescribeItem, zshSingleQuote } from "./index";

describe("@clip/completion-zsh", () => {
  test("escapes zsh single-quoted values and describe items", () => {
    expect(zshSingleQuote("cat's\napi\\v")).toBe("'cat'\\''s api\\\\v'");
    expect(zshDescribeItem({ value: "target:dev", description: "profile\nactive" })).toBe(
      "'target\\:dev:profile active'",
    );
  });

  test("renders a zsh completion script that delegates to completion query", () => {
    const script = renderZshCompletion({
      commandName: "clip-dev",
      styles: [{ tag: "custom-values", format: "%F{cyan}-- %d --%f", color: "=*=36" }],
    });

    expect(script).toContain("#compdef clip-dev");
    expect(script).toContain("completion query --shell zsh");
    expect(script).toContain("zstyle ':completion:*:*:clip-dev:*:custom-values' list-colors '=*=36'");
    expect(script).not.toContain("api-targets");
    expect(script).not.toContain("mcp-targets");
    expect(script).not.toContain("gateway-operations");
    expect(script).toContain("compdef _clip_completion clip-dev");
    expect(script).not.toContain("CLIP_HOME");
  });
});
