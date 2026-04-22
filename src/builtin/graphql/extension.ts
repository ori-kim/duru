import { getAuthStatus } from "../../commands/oauth.ts";
import { addTarget } from "../../config.ts";
import type { AddArgs, ClipExtension, ListOpts, NormalizeCtx } from "../../extension.ts";
import { die } from "../../utils/errors.ts";
import { subProfiles, subRecord } from "../../utils/env-sub.ts";
import { describeGraphqlTools, executeGraphql } from "./executor.ts";
import { type GraphqlTarget, graphqlTargetSchema } from "./schema.ts";

function normalizeGraphql(t: GraphqlTarget, ctx: NormalizeCtx): GraphqlTarget {
  return {
    ...t,
    headers: subRecord(t.headers, ctx.env),
    profiles: subProfiles(t.profiles, ctx.env, ["headers"]),
  };
}

export const extension: ClipExtension = {
  name: "builtin:graphql",
  init(api) {
    api.registerTargetType({
      type: "graphql",
      schema: graphqlTargetSchema,
      executor: executeGraphql,
      describeTools: (target, { targetName, headers }) => describeGraphqlTools(target, targetName, headers),
      normalizeConfig: (parsed, ctx) => normalizeGraphql(parsed as GraphqlTarget, ctx),
      aclRule: { skipSubcommands: ["describe", "types"] },
    });
    api.registerContribution({
      type: "graphql",
      listRenderer: async (name, target, opts: ListOpts) => {
        const t = target as GraphqlTarget;
        const { color, wsTag, bind } = opts;
        const nm = color("38;5;205", name.padEnd(16));
        const authStatus = t.oauth ? await getAuthStatus(name, "graphql") : null;
        const headers = t.headers as Record<string, string> | undefined;
        const statusTag = authStatus
          ? color("2", `  [${authStatus}]`)
          : t.oauth ? color("2", "  [not authenticated]")
          : headers?.["authorization"] ? color("2", "  [api key]")
          : color("2", "  [no auth]");
        const profileTag = (t as Record<string, unknown>).active ? ` @${(t as Record<string, unknown>).active}` : "";
        const aclStr = formatAcl(t as Record<string, unknown>);
        return `  ${nm} ${t.endpoint}${profileTag}${aclStr}${statusTag}${bind(name)}${wsTag(name)}`;
      },
      urlHeuristic: (url) => url.toLowerCase().endsWith("/graphql"),
      addHandler: async (args: AddArgs) => {
        const { name, positionals, flags, allow, deny, addOpts } = args;
        const endpoint = flags["endpoint"] ?? positionals[0];
        if (!endpoint) die("GraphQL target requires an endpoint URL (e.g. clip add gh https://api.github.com/graphql --graphql)");
        await addTarget(name, "graphql", { endpoint, allow, deny }, addOpts);
        console.log(`Added GraphQL target "${name}" → ${endpoint}`);
      },
      helpRenderer: async (_name, target) => {
        const t = target as GraphqlTarget;
        return `GraphQL: ${t.endpoint}`;
      },
      loginHandler: async (name, target) => {
        const { forceLogin } = await import("../../commands/oauth.ts");
        const t = target as GraphqlTarget;
        await forceLogin(name, t.endpoint, "graphql");
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
  if (acl) parts.push(`acl: [${Object.keys(acl).join(",")}]`);
  return parts.length > 0 ? `  (${parts.join("  ")})` : "";
}
