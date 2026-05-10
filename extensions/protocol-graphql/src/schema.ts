import { aclFields, aliasFields, profileFields, timeoutFields } from "@clip/core";
import { z } from "zod";

export const graphqlTargetSchema = z.object({
  endpoint: z.string().url(),
  introspect: z.boolean().optional(),
  headers: z.record(z.string()).optional(),
  oauth: z.boolean().optional(),
  ...timeoutFields,
  ...aclFields,
  ...profileFields,
  ...aliasFields,
});

export type GraphqlTarget = z.infer<typeof graphqlTargetSchema>;
