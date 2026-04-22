import type { ClipExtension, NormalizeCtx } from "../../extension.ts";
import { subProfiles, subRecord } from "../../utils/env-sub.ts";
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
  },
};
