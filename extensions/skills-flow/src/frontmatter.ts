import { die } from "@clip/core";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

export type Frontmatter = Record<string, unknown>;

export type ParseFrontmatterResult =
  | { ok: true; frontmatter: Frontmatter; body: string }
  | { ok: false; error: string };

function asRecord(value: unknown, label: string): Frontmatter {
  if (value === null || value === undefined) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    die(`${label} must be a YAML object`);
  }
  return value as Frontmatter;
}

export function parseFrontmatter(raw: string): ParseFrontmatterResult {
  const match = FRONTMATTER_RE.exec(raw);
  if (!match) return { ok: false, error: "Missing frontmatter. SKILL.md must start with --- ... ---" };

  try {
    const parsed = parseYaml(match[1] ?? "");
    if (parsed !== null && parsed !== undefined && (typeof parsed !== "object" || Array.isArray(parsed))) {
      return { ok: false, error: "Frontmatter must be a YAML object" };
    }
    return { ok: true, frontmatter: (parsed ?? {}) as Frontmatter, body: (match[2] ?? "").trimStart() };
  } catch (e) {
    return { ok: false, error: `Invalid YAML frontmatter: ${e instanceof Error ? e.message : String(e)}` };
  }
}

export async function readFrontmatterFileAsync(path: string): Promise<Frontmatter> {
  const file = Bun.file(path);
  if (!(await file.exists())) die(`Frontmatter file not found: ${path}`);
  let parsed: unknown;
  try {
    parsed = parseYaml(await file.text());
  } catch (e) {
    die(`Invalid YAML frontmatter file ${path}: ${e instanceof Error ? e.message : String(e)}`);
  }
  return asRecord(parsed, `Frontmatter file ${path}`);
}

export function stringifyFrontmatter(frontmatter: Frontmatter): string {
  return `---\n${stringifyYaml(frontmatter).trimEnd()}\n---\n`;
}
