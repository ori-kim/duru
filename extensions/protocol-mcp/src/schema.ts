import { z } from "zod";
import { aclFields, aliasFields, profileFields } from "@clip/core";

export const mcpHttpTargetSchema = z.object({
  transport: z.literal("http").optional().default("http"),
  url: z.string().url(),
  headers: z.record(z.string()).optional(),
  auth: z
    .union([z.literal("oauth"), z.literal("apikey"), z.literal(false)])
    .optional()
    .default(false),
  ...aclFields,
  ...profileFields,
  ...aliasFields,
});

export const mcpStdioTargetSchema = z.object({
  transport: z.literal("stdio"),
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
  ...aclFields,
  ...profileFields,
  ...aliasFields,
});

export const mcpSseTargetSchema = z.object({
  transport: z.literal("sse"),
  url: z.string().url(),
  headers: z.record(z.string()).optional(),
  auth: z
    .union([z.literal("oauth"), z.literal("apikey"), z.literal(false)])
    .optional()
    .default(false),
  ...aclFields,
  ...profileFields,
  ...aliasFields,
});

// stdio/sse 먼저 체크하여 transport 미지정은 http로 폴백
export const mcpTargetSchema = z.union([mcpStdioTargetSchema, mcpSseTargetSchema, mcpHttpTargetSchema]);

export type McpHttpTarget = z.infer<typeof mcpHttpTargetSchema>;
export type McpStdioTarget = z.infer<typeof mcpStdioTargetSchema>;
export type McpSseTarget = z.infer<typeof mcpSseTargetSchema>;
export type McpTarget = McpHttpTarget | McpStdioTarget | McpSseTarget;
