import { createPlugin, parseOptionSpec } from "@duru/cli-kit";
import type { CliPlugin } from "@duru/cli-kit";

export function outputFilter(): CliPlugin {
  return createPlugin((api) => {
    api.option(
      parseOptionSpec("-of, --output-filter <fields>", "Filter result to given fields (comma-separated, repeatable)"),
    );
  });
}
