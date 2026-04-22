import { z } from "zod";
import { aclFields, aliasFields, profileFields } from "@clip/core";

export const grpcTargetSchema = z.object({
  address: z.string().min(1),
  plaintext: z.boolean().optional(),
  proto: z.string().min(1).optional(),
  importPaths: z.array(z.string()).optional(),
  metadata: z.record(z.string()).optional(),
  reflectMetadata: z.record(z.string()).optional(),
  deadline: z.number().positive().optional(),
  emitDefaults: z.boolean().optional(),
  allowUnknownFields: z.boolean().optional(),
  oauth: z.boolean().optional(),
  ...aclFields,
  ...profileFields,
  ...aliasFields,
});

export type GrpcTarget = z.infer<typeof grpcTargetSchema>;
