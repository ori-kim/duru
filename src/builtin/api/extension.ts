import { getAuthStatus } from "../../commands/oauth.ts";
import { addTarget } from "../../config.ts";
import type { AddArgs, ClipExtension, ListOpts, NormalizeCtx } from "../../extension.ts";
import { die } from "../../utils/errors.ts";
import { subProfiles, subRecord } from "../../utils/env-sub.ts";
import { describeApiTools, executeApi } from "./executor.ts";
import { type ApiTarget, apiTargetSchema } from "./schema.ts";

function normalizeApi(t: ApiTarget, ctx: NormalizeCtx): ApiTarget {
  return {
    ...t,
    headers: subRecord(t.headers, ctx.env),
    profiles: subProfiles(t.profiles, ctx.env, ["headers"]),
  };
}

export const extension: ClipExtension = {
  name: "builtin:api",
  init(api) {
    api.registerTargetType({
      type: "api",
      schema: apiTargetSchema,
      executor: executeApi,
      describeTools: (target, { targetName }) => describeApiTools(target, targetName),
      normalizeConfig: (parsed, ctx) => normalizeApi(parsed as ApiTarget, ctx),
    });
    api.registerContribution({
      type: "api",
      listRenderer: async (name, target, opts: ListOpts) => {
        const t = target as ApiTarget;
        const { color, wsTag, bind } = opts;
        const nm = color("36", name.padEnd(16));
        const authStatus = await getAuthStatus(name, "api");
        const auth = t.auth;
        const statusTag = authStatus
          ? color("2", `  [${authStatus}]`)
          : auth === "oauth" ? color("2", "  [not authenticated]")
          : auth === "apikey" ? color("2", "  [api key]")
          : color("2", "  [no auth]");
        const profileTag = (t as Record<string, unknown>).active ? ` @${(t as Record<string, unknown>).active}` : "";
        const url = (t.baseUrl ?? t.openapiUrl ?? "") as string;
        const aclStr = formatAcl(t as Record<string, unknown>);
        return `  ${nm} ${url}${profileTag}${aclStr}${statusTag}${bind(name)}${wsTag(name)}`;
      },
      urlHeuristic: (url) => {
        const lower = url.toLowerCase().split("?")[0]!.split("#")[0]!;
        return /\/(openapi|swagger)\.(json|ya?ml)$/.test(lower) || /\/openapi\.json$/.test(lower);
      },
      addHandler: async (args: AddArgs) => {
        const { name, positionals, flags, allow, deny, addOpts } = args;
        const baseUrl = flags["base-url"] ?? flags["baseUrl"] ?? positionals[0];
        if (!baseUrl) die("API target requires a base URL (e.g. clip add petstore https://api.example.com)");
        const openapiUrl = flags["openapi-url"] ?? flags["openapiUrl"];
        await addTarget(name, "api", { auth: false, baseUrl, ...(openapiUrl ? { openapiUrl } : {}), allow, deny }, addOpts);
        console.log(`Added API target "${name}" → ${baseUrl}`);
        try {
          const resp = await fetch(openapiUrl ?? baseUrl);
          if (resp.ok) {
            const text = await resp.text();
            const spec = JSON.parse(text) as Record<string, unknown>;
            const components = spec["components"] as Record<string, unknown> | undefined;
            const schemes = Object.values(
              (components?.["securitySchemes"] as Record<string, unknown> | undefined) ??
                (spec["securityDefinitions"] as Record<string, unknown> | undefined) ??
                {},
            );
            if (schemes.length > 0) {
              const kinds = schemes
                .map((s) => (s as Record<string, string>)["type"] ?? (s as Record<string, string>)["scheme"])
                .join(", ");
              process.stderr.write(
                `clip: This API declares auth (${kinds}). Add 'auth: oauth' or 'auth: apikey' with 'headers:' in config.yml.\n`,
              );
            }
          }
        } catch { /* silent */ }
      },
      helpRenderer: async (_name, target) => {
        const t = target as ApiTarget;
        return `API: ${t.baseUrl ?? t.openapiUrl ?? ""}`;
      },
      loginHandler: async (name, target) => {
        const { forceLogin } = await import("../../commands/oauth.ts");
        const t = target as ApiTarget;
        if (!t.baseUrl) throw new Error(`"${name}" has no baseUrl configured. OAuth requires a baseUrl.`);
        await forceLogin(name, t.baseUrl, "api");
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
