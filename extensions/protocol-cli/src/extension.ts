import { addTarget, die } from "@clip/core";
import type { AddArgs, ClipExtension, ListOpts } from "@clip/core";
import { executeCli } from "./executor.ts";
import { type CliTarget, cliTargetSchema } from "./schema.ts";

export const extension: ClipExtension = {
  name: "builtin:cli",
  init(api) {
    api.registerTargetType({ type: "cli", schema: cliTargetSchema, executor: executeCli });
    api.registerResultPresenter({
      type: "cli",
      toViewModel(result, meta) {
        return { kind: "call-result", content: result, meta };
      },
    });
    api.registerContribution({
      type: "cli",
      listRenderer: async (name, target, opts: ListOpts) => {
        const t = target as CliTarget;
        const { color, bind } = opts;
        const nm = color("32", name.padEnd(16));
        const profileTag = t.active ? ` @${t.active}` : "";
        const aclStr = formatAcl(t as Record<string, unknown>);
        return `  ${nm} ${t.command}${profileTag}${aclStr}${bind(name)}`;
      },
      urlHeuristic: (url) => !url.startsWith("http://") && !url.startsWith("https://"),
      addHandler: async (args: AddArgs) => {
        const { name, positionals, flags, allow, deny } = args;
        const command = flags["command"] ?? positionals[0];
        if (!command) die("CLI target requires a command (e.g. clip add gh gh)");
        const prependArgs = flags["args"] ? flags["args"].split(",").map((s) => s.trim()) : undefined;
        await addTarget(name, "cli", { command, args: prependArgs, allow, deny });
        console.log(`Added CLI target "${name}" → ${command}`);
      },
      helpRenderer: async (_name, target) => {
        const t = target as CliTarget;
        return `CLI command: ${t.command}`;
      },
    });
  },
};

function formatAcl(target: Record<string, unknown>): string {
  const allow = target["allow"] as string[] | undefined;
  const deny = target["deny"] as string[] | undefined;
  const acl = target["acl"] as Record<string, unknown> | undefined;
  const parts: string[] = [];
  if (allow && allow.length > 0) parts.push(`allow: ${allow.join(",")}`);
  if (deny && deny.length > 0) parts.push(`deny: ${deny.join(",")}`);
  if (acl) {
    const keys = Object.keys(acl);
    parts.push(`acl: [${keys.join(",")}]`);
  }
  return parts.length > 0 ? `  (${parts.join("  ")})` : "";
}
