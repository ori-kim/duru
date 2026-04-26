import type { Registry } from "@clip/core";

export const BUILTIN_DESC: Record<string, string> = {
  add: "register a new CLI / MCP / API target",
  alias: "manage subcommand aliases",
  bind: "create a native command shim for a target",
  binds: "list currently bound targets",
  completion: "generate shell completion script",
  config: "edit / show clip config",
  ext: "manage extensions (list / enable / disable)",
  list: "list all registered targets",
  login: "OAuth login for an MCP / API target",
  logout: "remove stored OAuth tokens",
  profile: "manage profiles",
  refresh: "re-fetch OpenAPI spec for an API target",
  remove: "unregister a target",
  unbind: "remove a native command shim",
};

export type ClassifiedVerbs = {
  builtin: string[];
  extensions: string[];
};

export function classifyInternalVerbs(
  registry: Registry,
  phase1Verbs?: Set<string>,
): ClassifiedVerbs {
  const all = new Set(registry.listInternalVerbs());
  const userInit = new Set(registry.listUserInternalVerbs());
  const userAll = new Set([...userInit, ...(phase1Verbs ?? [])]);
  const builtin = [...all].filter((v) => !userAll.has(v)).sort();
  const extensions = [...userAll].sort();
  return { builtin, extensions };
}
