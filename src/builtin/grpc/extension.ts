import type { ClipExtension } from "../../extension.ts";
import { describeGrpcTools, executeGrpc } from "./executor.ts";
import { grpcTargetSchema } from "./schema.ts";

export const extension: ClipExtension = {
  name: "builtin:grpc",
  init(api) {
    api.registerTargetType({
      type: "grpc",
      schema: grpcTargetSchema,
      executor: executeGrpc,
      describeTools: (target, { targetName }) => describeGrpcTools(target, targetName),
    });
  },
};
