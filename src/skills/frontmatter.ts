import { z } from "zod";
import { parse as yamlParse } from "yaml";
import { die } from "../utils/errors.ts";

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

const InputSchema = z.object({
  type: z.literal("string").default("string"),
  required: z.boolean().optional(),
  default: z.string().optional(),
  description: z.string().optional(),
});

export const SkillFrontmatterSchema = z.object({
  name: z.string(),
  description: z.string(),
  tags: z.array(z.string()).optional(),
  inputs: z.record(InputSchema).optional(),
  workflow: z.string().optional(), // Phase 3+ runner — MVP는 read-only 보존
});

export type SkillFrontmatter = z.infer<typeof SkillFrontmatterSchema>;

export function parseSkillFile(raw: string, filePath?: string): { fm: SkillFrontmatter; body: string } {
  const match = FM_RE.exec(raw);
  let body = raw;
  let fm: SkillFrontmatter;

  if (match) {
    const yamlStr = match[1] ?? "";
    const bodyStr = match[2] ?? "";
    body = bodyStr.trimStart();
    let parsed: unknown;
    try {
      parsed = yamlParse(yamlStr);
    } catch (e) {
      die(`Invalid YAML frontmatter${filePath ? ` in ${filePath}` : ""}: ${e}`);
    }
    const result = SkillFrontmatterSchema.safeParse(parsed);
    if (!result.success) {
      const msg = result.error.errors.map((e) => `  ${e.path.join(".")}: ${e.message}`).join("\n");
      die(`Invalid skill frontmatter${filePath ? ` in ${filePath}` : ""}:\n${msg}`);
    }
    fm = result.data;
  } else {
    die(`Missing frontmatter${filePath ? ` in ${filePath}` : ""}. SKILL.md must start with --- ... ---`);
  }

  return { fm, body };
}

export function renderPrompt(body: string, inputs: Record<string, string>): string {
  return body.replace(/\{\{\s*inputs\.([a-zA-Z0-9_-]+)\s*\}\}/g, (_, key: string) => {
    if (key in inputs) return inputs[key] as string;
    return die(`Missing input: ${key}`);
  });
}
