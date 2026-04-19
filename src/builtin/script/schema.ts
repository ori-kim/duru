import { z } from "zod";
import { aclFields, aliasFields, profileFields } from "../../utils/target-schema.ts";

const RESERVED_SCRIPT_CMDS = ["tools", "describe", "types", "refresh", "login", "logout"];

export const scriptCommandSchema = z
  .object({
    script: z.string().min(1).optional(),
    file: z.string().min(1).optional(),
    description: z.string().optional(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string()).optional(),
  })
  .refine((d) => !!d.script !== !!d.file, {
    message: "exactly one of `script` or `file` must be set",
  });

export const scriptTargetSchema = z.object({
  description: z.string().optional(),
  commands: z
    .record(scriptCommandSchema)
    .refine((m) => Object.keys(m).every((k) => !RESERVED_SCRIPT_CMDS.includes(k)), {
      message: `command names cannot be reserved: ${RESERVED_SCRIPT_CMDS.join(", ")}`,
    })
    .default({}),
  env: z.record(z.string()).optional(),
  ...aclFields,
  ...profileFields,
  ...aliasFields,
});

export type ScriptCommandDef = z.infer<typeof scriptCommandSchema>;
export type ScriptTarget = z.infer<typeof scriptTargetSchema>;
