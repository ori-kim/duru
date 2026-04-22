import { resolveAuthDir, getAuthStatus } from "@clip/auth";
import { addTarget, die, subProfiles, subRecord } from "@clip/core";
import type { AddArgs, ClipExtension, ListOpts, NormalizeCtx } from "@clip/core";
import { describeGrpcTools, executeGrpc } from "./executor.ts";
import { type GrpcTarget, grpcTargetSchema } from "./schema.ts";

function normalizeGrpc(t: GrpcTarget, ctx: NormalizeCtx): GrpcTarget {
  return {
    ...t,
    metadata: subRecord(t.metadata, ctx.env),
    reflectMetadata: subRecord(t.reflectMetadata, ctx.env),
    profiles: subProfiles(t.profiles, ctx.env, ["metadata"]),
  };
}

export const extension: ClipExtension = {
  name: "builtin:grpc",
  init(api) {
    api.registerTargetType({
      type: "grpc",
      schema: grpcTargetSchema,
      executor: executeGrpc,
      describeTools: (target, { targetName, headers }) => describeGrpcTools(target, targetName, headers),
      normalizeConfig: (parsed, ctx) => normalizeGrpc(parsed as GrpcTarget, ctx),
      aclRule: { skipSubcommands: ["describe", "types"] },
    });
    api.registerResultPresenter({
      type: "grpc",
      toViewModel(result, meta) {
        return { kind: "call-result", content: result, meta };
      },
    });
    api.registerContribution({
      type: "grpc",
      listRenderer: async (name, target, opts: ListOpts) => {
        const t = target as GrpcTarget;
        const { color, wsTag, bind } = opts;
        const nm = color("1;34", name.padEnd(16));
        const configDir = resolveAuthDir(name, "grpc");
        const authStatus = t.oauth ? await getAuthStatus(configDir) : null;
        const metadata = t.metadata as Record<string, string> | undefined;
        const statusTag = authStatus
          ? color("2", `  [${authStatus}]`)
          : t.oauth ? color("2", "  [not authenticated]")
          : metadata?.["authorization"] ? color("2", "  [api key]")
          : color("2", "  [no auth]");
        const profileTag = (t as Record<string, unknown>).active ? ` @${(t as Record<string, unknown>).active}` : "";
        const aclStr = formatAcl(t as Record<string, unknown>);
        return `  ${nm} ${t.address}${profileTag}${aclStr}${statusTag}${bind(name)}${wsTag(name)}`;
      },
      urlHeuristic: () => false,
      addHandler: async (args: AddArgs) => {
        const { name, positionals, flags, allow, deny, addOpts } = args;
        const address = flags["address"] ?? positionals[0];
        if (!address) die("gRPC target requires an address (e.g. clip add petstore grpc.example.com:443 --grpc)");
        const proto = flags["proto"] ?? undefined;
        const plaintext = flags["plaintext"] ? true : undefined;
        await addTarget(name, "grpc", {
          address,
          ...(proto ? { proto } : {}),
          ...(plaintext ? { plaintext } : {}),
          allow,
          deny,
        }, addOpts);
        console.log(`Added gRPC target "${name}" → ${address}`);
      },
      helpRenderer: async (_name, target) => {
        const t = target as GrpcTarget;
        return `gRPC: ${t.address}`;
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
