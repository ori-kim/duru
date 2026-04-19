import { z } from "zod";

const aclNodeSchema = z.object({
  allow: z.array(z.string()).optional(),
  deny: z.array(z.string()).optional(),
});

const aclTreeSchema = z.record(aclNodeSchema);

export const aclFields = {
  allow: z.array(z.string()).optional(),
  deny: z.array(z.string()).optional(),
  acl: aclTreeSchema.optional(),
};

export const aliasSchema = z.object({
  subcommand: z.string().min(1),
  args: z.array(z.string()).optional(),
  input: z.record(z.unknown()).optional(),
  description: z.string().optional(),
});

export const aliasFields = {
  aliases: z.record(aliasSchema).optional(),
};

export const profileOverrideSchema = z.object({
  args: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
  command: z.string().optional(),
  url: z.string().url().optional(),
  endpoint: z.string().url().optional(),
  address: z.string().optional(),
  baseUrl: z.string().url().optional(),
  openapiUrl: z.string().url().optional(),
  headers: z.record(z.string()).optional(),
  metadata: z.record(z.string()).optional(),
});

export const profileFields = {
  profiles: z.record(profileOverrideSchema).optional(),
  active: z.string().optional(),
};

export const commonTargetFields = { ...aclFields, ...aliasFields, ...profileFields };

export type ProfileOverride = z.infer<typeof profileOverrideSchema>;
export type AliasDef = z.infer<typeof aliasSchema>;
export type AclNode = z.infer<typeof aclNodeSchema>;
export type AclTree = z.infer<typeof aclTreeSchema>;
