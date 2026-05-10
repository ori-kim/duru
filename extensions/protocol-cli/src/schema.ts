import { aliasFields, profileFields, timeoutFields } from "@clip/core";
import { z } from "zod";

const aclTreeSchema = z.record(
  z.object({
    allow: z.array(z.string()).optional(),
    deny: z.array(z.string()).optional(),
  }),
);

export const cliTargetSchema = z.object({
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
  allow: z.array(z.string()).optional(),
  deny: z.array(z.string()).optional(),
  acl: aclTreeSchema.optional(),
  ...timeoutFields,
  ...profileFields,
  ...aliasFields,
});

export type CliTarget = z.infer<typeof cliTargetSchema>;
