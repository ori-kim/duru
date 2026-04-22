import { z } from "zod";
import { aclFields, aliasFields, profileFields } from "@clip/core";

export const apiTargetSchema = z.object({
  openapiUrl: z.string().url().optional(),
  baseUrl: z.string().url().optional(),
  headers: z.record(z.string()).optional(),
  auth: z
    .union([z.literal("oauth"), z.literal("apikey"), z.literal(false)])
    .optional()
    .default(false),
  ...aclFields,
  ...profileFields,
  ...aliasFields,
});

export type ApiTarget = z.infer<typeof apiTargetSchema>;
