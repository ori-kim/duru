import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { basename, extname, isAbsolute, join, relative, resolve } from "node:path";
import { ClipError, die } from "@clip/core";
import type { InternalCommandLateFlags } from "@clip/core";
import { type Frontmatter, parseFrontmatter, readFrontmatterFileAsync, stringifyFrontmatter } from "./frontmatter.ts";
import { buildWebPayload, parseWebArgs, serveSkillsFlowWeb } from "./web.ts";
import type { WebPackageSummary } from "./web.ts";

const SUPPORTED_SCHEMA_VERSION = "1";
const NAME_RE = /^[a-zA-Z0-9_-]+$/;
const RESERVED_NAMES = new Set(["create", "list", "show", "validate", "web", "export"]);

type FlowNode = {
  id?: unknown;
  type?: unknown;
  name?: unknown;
  link?: unknown;
};

type FlowEdge = {
  id?: unknown;
  from?: unknown;
  to?: unknown;
  type?: unknown;
  name?: unknown;
};

type FlowJson = {
  schemaVersion?: unknown;
  name?: unknown;
  entryNode?: unknown;
  nodes?: unknown;
  edges?: unknown;
};

export type ValidationIssue = {
  code: string;
  message: string;
  path?: string;
};

export type ValidationResult = {
  valid: boolean;
  status: "valid" | "warning" | "invalid";
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  flow?: FlowJson;
  dir: string;
};

type CreateArgs = {
  name: string;
  description: string;
  force: boolean;
  frontmatter: string[];
  frontmatterFiles: string[];
};

function clipHome(): string {
  return process.env.CLIP_HOME ?? join(homedir(), ".clip");
}

export function getSkillsFlowDir(): string {
  return join(clipHome(), "skills-flow");
}

function skillDir(name: string): string {
  return join(getSkillsFlowDir(), name);
}

function listSkillsFlowPackageDirs(): string[] {
  const root = getSkillsFlowDir();
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(root, entry.name))
    .sort();
}

function resolveSkillDir(name: string): string | undefined {
  if (!NAME_RE.test(name)) return undefined;
  const dir = skillDir(name);
  return existsSync(dir) ? dir : undefined;
}

function validateSkillName(name: string): void {
  if (!NAME_RE.test(name)) die("Skill name may only contain letters, digits, _ and -");
  if (RESERVED_NAMES.has(name)) die(`"${name}" is a reserved skills-flow name`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function parseCreateArgs(args: string[]): CreateArgs {
  const name = args[0];
  if (!name) {
    die(
      "Usage: clip skills-flow create <name> --description <text> [--frontmatter k=v] [--frontmatter-file file.yml] [--force]",
    );
  }
  validateSkillName(name);

  let description = "";
  let force = false;
  const frontmatter: string[] = [];
  const frontmatterFiles: string[] = [];

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) continue;
    if (arg === "--description" || arg === "-d") {
      description = args[++i] ?? die("--description requires a value");
    } else if (arg.startsWith("--description=")) {
      description = arg.slice("--description=".length);
    } else if (arg === "--frontmatter") {
      frontmatter.push(args[++i] ?? die("--frontmatter requires key=value"));
    } else if (arg.startsWith("--frontmatter=")) {
      frontmatter.push(arg.slice("--frontmatter=".length));
    } else if (arg === "--frontmatter-file") {
      frontmatterFiles.push(args[++i] ?? die("--frontmatter-file requires a path"));
    } else if (arg.startsWith("--frontmatter-file=")) {
      frontmatterFiles.push(arg.slice("--frontmatter-file=".length));
    } else if (arg === "--force") {
      force = true;
    } else {
      die(`Unknown option: ${arg}`);
    }
  }

  if (!description.trim()) die("--description is required");
  return { name, description, force, frontmatter, frontmatterFiles };
}

function parseFrontmatterPair(pair: string): [string, string] {
  const eq = pair.indexOf("=");
  if (eq < 1) die(`--frontmatter must be key=value, got: ${pair}`);
  const key = pair.slice(0, eq).trim();
  if (!key) die(`--frontmatter key may not be empty: ${pair}`);
  return [key, pair.slice(eq + 1)];
}

async function resolveCreateFrontmatter(args: CreateArgs): Promise<Frontmatter> {
  const extra: Frontmatter = {};

  for (const file of args.frontmatterFiles) {
    Object.assign(extra, await readFrontmatterFileAsync(resolve(file)));
  }

  for (const pair of args.frontmatter) {
    const [key, value] = parseFrontmatterPair(pair);
    extra[key] = value;
  }

  return {
    ...extra,
    name: args.name,
    description: args.description,
  };
}

function buildSkillMarkdown(name: string, frontmatter: Frontmatter): string {
  return `${stringifyFrontmatter(frontmatter)}
# ${name}

This skill is defined by \`flow.json\`.

Read \`flow.json\` first. Treat it as the source of truth for step order and relationships. Follow each node's \`link\` markdown file according to the graph structure.
`;
}

function buildEmptyFlow(name: string): FlowJson {
  return {
    schemaVersion: SUPPORTED_SCHEMA_VERSION,
    name,
    nodes: [],
    edges: [],
  };
}

async function cmdCreate(args: string[]): Promise<void> {
  const parsed = parseCreateArgs(args);
  const dir = skillDir(parsed.name);

  if (existsSync(dir)) {
    if (!parsed.force) die(`skills-flow package already exists: ${dir}\nUse --force to recreate it.`);
    rmSync(dir, { recursive: true, force: true });
  }

  mkdirSync(dir, { recursive: true });
  const frontmatter = await resolveCreateFrontmatter(parsed);
  await Bun.write(join(dir, "SKILL.md"), buildSkillMarkdown(parsed.name, frontmatter));
  await Bun.write(join(dir, "flow.json"), `${JSON.stringify(buildEmptyFlow(parsed.name), null, 2)}\n`);
  console.log(`Created: ${dir}`);
}

function readSkillFrontmatter(dir: string): { frontmatter?: Frontmatter; error?: string } {
  const file = join(dir, "SKILL.md");
  if (!existsSync(file)) return { error: "SKILL.md is missing" };
  const parsed = parseFrontmatter(readFileSync(file, "utf8"));
  if (!parsed.ok) return { error: parsed.error };
  return { frontmatter: parsed.frontmatter };
}

function readFlow(dir: string, errors: ValidationIssue[]): FlowJson | undefined {
  const flowPath = join(dir, "flow.json");
  if (!existsSync(flowPath)) {
    errors.push({ code: "flow.missing", message: "flow.json is missing", path: "flow.json" });
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(flowPath, "utf8"));
  } catch (e) {
    errors.push({
      code: "flow.parse",
      message: `flow.json could not be parsed: ${e instanceof Error ? e.message : String(e)}`,
      path: "flow.json",
    });
    return undefined;
  }

  if (!isRecord(parsed)) {
    errors.push({ code: "flow.object", message: "flow.json must contain a JSON object", path: "flow.json" });
    return undefined;
  }

  return parsed as FlowJson;
}

function requireString(value: unknown, path: string, errors: ValidationIssue[]): value is string {
  if (isNonEmptyString(value)) return true;
  errors.push({ code: "field.required", message: `${path} must be a non-empty string`, path });
  return false;
}

function validateNodeLink(dir: string, nodeId: string, link: string, errors: ValidationIssue[]): void {
  if (isAbsolute(link)) {
    errors.push({ code: "node.link.absolute", message: `node "${nodeId}" link must be relative`, path: link });
    return;
  }
  if (extname(link) !== ".md") {
    errors.push({ code: "node.link.markdown", message: `node "${nodeId}" link must point to a .md file`, path: link });
  }
  const abs = resolve(dir, link);
  const rel = relative(dir, abs);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    errors.push({
      code: "node.link.outside",
      message: `node "${nodeId}" link must stay inside the skill folder`,
      path: link,
    });
    return;
  }
  if (!existsSync(abs)) {
    errors.push({ code: "node.link.missing", message: `node "${nodeId}" link file does not exist`, path: link });
  }
}

export function validateSkillsFlowPackage(dir: string): ValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const flow = readFlow(dir, errors);
  const folderName = basename(dir);

  const nodeIds = new Set<string>();
  const edgeIds = new Set<string>();
  let nodes: FlowNode[] = [];
  let edges: FlowEdge[] = [];

  if (flow) {
    if (!requireString(flow.schemaVersion, "schemaVersion", errors)) {
      // handled by requireString
    } else if (flow.schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
      errors.push({
        code: "schema.unsupported",
        message: `Unsupported schemaVersion "${flow.schemaVersion}". Expected "${SUPPORTED_SCHEMA_VERSION}".`,
        path: "schemaVersion",
      });
    }

    if (requireString(flow.name, "name", errors) && flow.name !== folderName) {
      warnings.push({
        code: "name.folder_mismatch",
        message: `flow.json name "${flow.name}" does not match folder name "${folderName}"`,
        path: "name",
      });
    }

    if (!Array.isArray(flow.nodes)) {
      errors.push({ code: "nodes.array", message: "nodes must be an array", path: "nodes" });
    } else {
      nodes = flow.nodes as FlowNode[];
    }

    if (!Array.isArray(flow.edges)) {
      errors.push({ code: "edges.array", message: "edges must be an array", path: "edges" });
    } else {
      edges = flow.edges as FlowEdge[];
    }

    nodes.forEach((node, index) => {
      const nodePath = `nodes[${index}]`;
      if (!isRecord(node)) {
        errors.push({ code: "node.object", message: `${nodePath} must be an object`, path: nodePath });
        return;
      }
      if (!requireString(node.id, `${nodePath}.id`, errors)) return;
      if (nodeIds.has(node.id)) {
        errors.push({ code: "node.duplicate_id", message: `Duplicate node id "${node.id}"`, path: `${nodePath}.id` });
      }
      nodeIds.add(node.id);
      requireString(node.type, `${nodePath}.type`, errors);
      requireString(node.name, `${nodePath}.name`, errors);
      if (requireString(node.link, `${nodePath}.link`, errors)) validateNodeLink(dir, node.id, node.link, errors);
    });

    edges.forEach((edge, index) => {
      const edgePath = `edges[${index}]`;
      if (!isRecord(edge)) {
        errors.push({ code: "edge.object", message: `${edgePath} must be an object`, path: edgePath });
        return;
      }
      if (requireString(edge.id, `${edgePath}.id`, errors)) {
        if (edgeIds.has(edge.id)) {
          errors.push({ code: "edge.duplicate_id", message: `Duplicate edge id "${edge.id}"`, path: `${edgePath}.id` });
        }
        edgeIds.add(edge.id);
      }
      const hasFrom = requireString(edge.from, `${edgePath}.from`, errors);
      const hasTo = requireString(edge.to, `${edgePath}.to`, errors);
      requireString(edge.type, `${edgePath}.type`, errors);
      requireString(edge.name, `${edgePath}.name`, errors);
      if (hasFrom && !nodeIds.has(edge.from)) {
        errors.push({
          code: "edge.from_missing",
          message: `edge "${edge.id}" references missing from node "${edge.from}"`,
          path: `${edgePath}.from`,
        });
      }
      if (hasTo && !nodeIds.has(edge.to)) {
        errors.push({
          code: "edge.to_missing",
          message: `edge "${edge.id}" references missing to node "${edge.to}"`,
          path: `${edgePath}.to`,
        });
      }
    });

    if (flow.entryNode !== undefined) {
      if (requireString(flow.entryNode, "entryNode", errors) && !nodeIds.has(flow.entryNode)) {
        errors.push({
          code: "entryNode.missing",
          message: `entryNode "${flow.entryNode}" does not reference an existing node`,
          path: "entryNode",
        });
      }
    } else if (nodes.length > 0) {
      warnings.push({
        code: "entryNode.missing",
        message: "entryNode is missing while nodes are present",
        path: "entryNode",
      });
    }
  }

  const skill = readSkillFrontmatter(dir);
  if (!skill.frontmatter) {
    warnings.push({
      code: "skill.frontmatter",
      message: skill.error ?? "SKILL.md frontmatter could not be read",
      path: "SKILL.md",
    });
  } else {
    const fmName = skill.frontmatter.name;
    const description = skill.frontmatter.description;
    if (!isNonEmptyString(fmName)) {
      warnings.push({ code: "skill.name_missing", message: "SKILL.md frontmatter name is missing", path: "SKILL.md" });
    } else if (isNonEmptyString(flow?.name) && fmName !== flow.name) {
      warnings.push({
        code: "name.skill_mismatch",
        message: `SKILL.md name "${fmName}" does not match flow.json name "${flow.name}"`,
        path: "SKILL.md",
      });
    }
    if (!isNonEmptyString(description)) {
      warnings.push({
        code: "skill.description_missing",
        message: "SKILL.md frontmatter description is missing",
        path: "SKILL.md",
      });
    }
  }

  const status = errors.length > 0 ? "invalid" : warnings.length > 0 ? "warning" : "valid";
  return { valid: errors.length === 0, status, errors, warnings, flow, dir };
}

function getExistingSkillDir(name: string): string {
  validateSkillName(name);
  const dir = skillDir(name);
  if (!existsSync(dir)) die(`skills-flow package not found: ${dir}`);
  return dir;
}

async function cmdWeb(args: string[]): Promise<void> {
  const parsed = parseWebArgs(args);
  if (parsed.name) validateSkillName(parsed.name);
  if (parsed.name && !resolveSkillDir(parsed.name)) die(`skills-flow package not found: ${skillDir(parsed.name)}`);
  const rootDir = getSkillsFlowDir();

  const loadPayload = (requestedName?: string) => {
    const packages = buildWebPackageSummaries();
    const selectedName = requestedName ?? parsed.name;
    const selectedDir = selectedName ? resolveSkillDir(selectedName) : undefined;
    const dir = selectedDir ?? packages[0]?.dir;
    if (!dir) return buildWebPayload(null, null, null, packages, rootDir);
    const result = validateSkillsFlowPackage(dir);
    const name = isNonEmptyString(result.flow?.name) ? result.flow.name : basename(dir);
    return buildWebPayload(name, dir, result, packages, rootDir);
  };

  await serveSkillsFlowWeb({
    ...parsed,
    rootDir,
    loadPayload,
    resolveDir: resolveSkillDir,
  });
}

function loadDescription(dir: string): string {
  const skill = readSkillFrontmatter(dir);
  const value = skill.frontmatter?.description;
  return typeof value === "string" ? value : "";
}

function countFlowItems(flow: FlowJson | undefined): { nodes: string; edges: string; entryNode: string } {
  return {
    nodes: Array.isArray(flow?.nodes) ? String(flow.nodes.length) : "-",
    edges: Array.isArray(flow?.edges) ? String(flow.edges.length) : "-",
    entryNode: typeof flow?.entryNode === "string" ? flow.entryNode : "",
  };
}

function buildWebPackageSummaries(): WebPackageSummary[] {
  return listSkillsFlowPackageDirs().map((dir) => {
    const result = validateSkillsFlowPackage(dir);
    const name = isNonEmptyString(result.flow?.name) ? result.flow.name : basename(dir);
    return {
      id: basename(dir),
      name,
      dir,
      description: loadDescription(dir),
      status: result.status,
      valid: result.valid,
      nodes: Array.isArray(result.flow?.nodes) ? result.flow.nodes.length : 0,
      edges: Array.isArray(result.flow?.edges) ? result.flow.edges.length : 0,
    };
  });
}

function printIssues(result: ValidationResult): void {
  for (const issue of result.errors) {
    console.log(`error ${issue.code}: ${issue.message}`);
  }
  for (const issue of result.warnings) {
    console.log(`warning ${issue.code}: ${issue.message}`);
  }
}

function cmdShow(args: string[]): void {
  const name = args[0];
  if (!name) die("Usage: clip skills-flow show <name> [--verbose]");
  let verbose = false;
  for (const arg of args.slice(1)) {
    if (arg === "--verbose") verbose = true;
    else die(`Unknown option: ${arg}`);
  }

  const dir = getExistingSkillDir(name);
  const result = validateSkillsFlowPackage(dir);
  const counts = countFlowItems(result.flow);
  const flowName = isNonEmptyString(result.flow?.name) ? result.flow.name : name;

  console.log(`name: ${flowName}`);
  console.log(`description: ${loadDescription(dir)}`);
  console.log(`path: ${dir}`);
  console.log(`status: ${result.status}`);
  console.log(`nodes: ${counts.nodes}`);
  console.log(`edges: ${counts.edges}`);
  console.log(`entryNode: ${counts.entryNode}`);
  printIssues(result);

  if (verbose && result.flow) {
    console.log("");
    console.log(JSON.stringify(result.flow, null, 2));
  }
}

function pad(value: string, width: number): string {
  return value.padEnd(width);
}

function printRows(headers: string[], rows: string[][]): void {
  const widths = headers.map((header, index) => Math.max(header.length, ...rows.map((row) => row[index]?.length ?? 0)));
  console.log(headers.map((header, index) => pad(header, widths[index] ?? 0)).join("  "));
  console.log(widths.map((width) => "-".repeat(width)).join("  "));
  for (const row of rows) console.log(row.map((cell, index) => pad(cell, widths[index] ?? 0)).join("  "));
}

function cmdList(args: string[]): void {
  let verbose = false;
  for (const arg of args) {
    if (arg === "--verbose") verbose = true;
    else die(`Unknown option: ${arg}`);
  }

  const dirs = listSkillsFlowPackageDirs();

  if (dirs.length === 0) {
    console.log("No skills-flow packages found.");
    console.log("Create one: clip skills-flow create <name> --description <text>");
    return;
  }

  const rows = dirs.map((dir) => {
    const result = validateSkillsFlowPackage(dir);
    const name = isNonEmptyString(result.flow?.name) ? result.flow.name : basename(dir);
    if (!verbose) return [name, result.status, dir];
    const counts = countFlowItems(result.flow);
    return [name, result.status, counts.nodes, counts.edges, loadDescription(dir), dir];
  });

  if (verbose) printRows(["NAME", "STATUS", "NODES", "EDGES", "DESCRIPTION", "PATH"], rows);
  else printRows(["NAME", "STATUS", "PATH"], rows);
}

function cmdValidate(args: string[], lateFlags?: InternalCommandLateFlags): void {
  const positional: string[] = [];
  let json = lateFlags?.jsonMode ?? false;
  for (const arg of args) {
    if (arg === "--json") json = true;
    else if (arg.startsWith("-")) die(`Unknown option: ${arg}`);
    else positional.push(arg);
  }

  const name = positional[0];
  if (!name) die("Usage: clip skills-flow validate <name> [--json]");
  if (positional.length > 1) die(`Unexpected argument: ${positional[1]}`);

  const result = validateSkillsFlowPackage(getExistingSkillDir(name));
  if (json) {
    console.log(JSON.stringify({ valid: result.valid, errors: result.errors, warnings: result.warnings }, null, 2));
  } else {
    console.log(`${name}: ${result.status}`);
    printIssues(result);
  }

  if (!result.valid) throw new ClipError("skills-flow validation failed", 1);
}

export async function runSkillsFlowCmd(args: string[], lateFlags?: InternalCommandLateFlags): Promise<void> {
  const subcommand = args[0];
  const rest = args.slice(1);

  switch (subcommand) {
    case "create":
      await cmdCreate(rest);
      break;
    case "list":
      cmdList(rest);
      break;
    case "show":
      cmdShow(rest);
      break;
    case "validate":
      cmdValidate(rest, lateFlags);
      break;
    case "web":
      await cmdWeb(rest);
      break;
    default:
      die(
        [
          "Usage: clip skills-flow <subcommand> [args]",
          "",
          "Commands:",
          "  create <name> --description <text> [--frontmatter k=v] [--frontmatter-file file.yml] [--force]",
          "  list [--verbose]",
          "  show <name> [--verbose]",
          "  validate <name> [--json]",
          "  web <name> [--host 127.0.0.1] [--port 3907]",
        ].join("\n"),
      );
  }
}
