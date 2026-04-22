import { z } from "zod";
import { aclFields, aliasFields, profileFields } from "@clip/core";

export const graphqlTargetSchema = z.object({
  endpoint: z.string().url(),
  introspect: z.boolean().optional(),
  headers: z.record(z.string()).optional(),
  oauth: z.boolean().optional(),
  ...aclFields,
  ...profileFields,
  ...aliasFields,
});

export type GraphqlTarget = z.infer<typeof graphqlTargetSchema>;
