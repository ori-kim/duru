import { aclFields, aliasFields, profileFields, timeoutFields } from "@clip/core";
import { z } from "zod";

export const apiTargetSchema = z.object({
  openapiUrl: z.string().url().optional(),
  baseUrl: z.string().url().optional(),
  headers: z.record(z.string()).optional(),
  auth: z
    .union([z.literal("oauth"), z.literal("apikey"), z.literal(false)])
    .optional()
    .default(false),
  ...timeoutFields,
  ...aclFields,
  ...profileFields,
  ...aliasFields,
});

export type ApiTarget = z.infer<typeof apiTargetSchema>;
