import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { createInterface } from "node:readline/promises";
import { isCancel, multiselect } from "@clack/prompts";
import { die } from "@clip/core";
import { parse as yamlParse, stringify as yamlStringify } from "yaml";
import type { ContributesSpec, ExtensionEntry } from "../extension-loader.ts";

type GithubSource = {
  type: "github";
  owner: string;
  repo: string;
  dir: string;
  ref?: string;
};

type CatalogEntry = {
  name: string;
  dir: string;
  description?: string;
  tags?: string[];
};

type ExtensionCatalog = {
  extensions: CatalogEntry[];
};

type ExtensionMetadata = {
  name: string;
  version?: string;
  description?: string;
  entry: string;
  contributes?: ContributesSpec;
  runtime?: {
    dependencies?: Record<string, string>;
  };
};

type InstallRecord = {
  schemaVersion: 1;
  name: string;
  version?: string;
  installedAt: string;
  source: GithubSource & {
    resolvedCommit: string;
  };
  manifestEntry: ExtensionEntry;
};

type InstallOptions = {
  source: GithubSource;
  name?: string;
  force?: boolean;
  yes?: boolean;
  noDeps?: boolean;
  update?: boolean;
};

type ParsedArgs = {
  rest: string[];
  flags: Record<string, string | true>;
};

const CATALOG_FILES = [
  ".clip/extension-index.yaml",
  ".clip/extension-index.yml",
  ".clip/extension-index.json",
  ".clip/extensions.yaml",
  ".clip/extensions.yml",
  ".clip/extensions.json",
  "clip/extensions.yaml",
  "clip/extensions.yml",
  "clip/extensions.json",
];
const METADATA_FILES = ["clip/extension.yaml", "clip/extension.yml", "clip/extension.json", "clip-extension.json"];
const INSTALL_RECORD_FILE = ".clip-install.json";
const INSTALL_IGNORE_NAMES = new Set([
  ".git",
  "node_modules",
  "package-lock.json",
  "bun.lock",
  "pnpm-lock.yaml",
  "yarn.lock",
]);

function parseArgs(args: string[]): ParsedArgs {
  const rest: string[] = [];
  const flags: Record<string, string | true> = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? "";
    if (!arg.startsWith("--")) {
      rest.push(arg);
      continue;
    }

    const eq = arg.indexOf("=");
    if (eq >= 0) {
      flags[arg.slice(2, eq)] = arg.slice(eq + 1);
      continue;
    }

    const name = arg.slice(2);
    if (["force", "yes", "no-deps", "all"].includes(name)) {
      flags[name] = true;
      continue;
    }

    const value = args[i + 1];
    if (!value || value.startsWith("--")) die(`Missing value for --${name}`);
    flags[name] = value;
    i++;
  }

  return { rest, flags };
}

function flagString(flags: Record<string, string | true>, name: string): string | undefined {
  const value = flags[name];
  return typeof value === "string" ? value : undefined;
}

function flagBool(flags: Record<string, string | true>, name: string): boolean {
  return flags[name] === true;
}

function normalizeDir(dir: string | undefined): string {
  const normalized = (dir ?? ".").replace(/^\/+/, "").replace(/\/+$/, "");
  return normalized || ".";
}

export function parseGithubSource(spec: string, opts: { dir?: string; ref?: string } = {}): GithubSource {
  let owner = "";
  let repo = "";
  let dir = opts.dir;
  let ref = opts.ref;

  if (spec.startsWith("github:")) {
    const path = spec.slice("github:".length).replace(/^\/+/, "");
    const parts = path.split("/").filter(Boolean);
    owner = parts[0] ?? "";
    repo = parts[1] ?? "";
    if (!dir && parts.length > 2) dir = parts.slice(2).join("/");
  } else if (spec.startsWith("https://github.com/") || spec.startsWith("http://github.com/")) {
    const url = new URL(spec);
    const parts = url.pathname.split("/").filter(Boolean);
    owner = parts[0] ?? "";
    repo = (parts[1] ?? "").replace(/\.git$/, "");

    const treeIndex = parts.indexOf("tree");
    if (treeIndex >= 0) {
      if (!ref) ref = parts[treeIndex + 1];
      if (!dir) dir = parts.slice(treeIndex + 2).join("/");
    } else if (!dir && parts.length > 2) {
      dir = parts.slice(2).join("/");
    }
  } else {
    const parts = spec.replace(/^\/+/, "").split("/").filter(Boolean);
    owner = parts[0] ?? "";
    repo = (parts[1] ?? "").replace(/\.git$/, "");
    if (!dir && parts.length > 2) dir = parts.slice(2).join("/");
  }

  if (!owner || !repo) {
    die("Usage: clip ext install github:<owner>/<repo> [--dir <extension-dir>]");
  }

  return { type: "github", owner, repo, dir: normalizeDir(dir), ...(ref ? { ref } : {}) };
}

function githubUrl(source: GithubSource): string {
  return `https://github.com/${source.owner}/${source.repo}.git`;
}

function run(cmd: string, args: string[], cwd?: string): string {
  try {
    return execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch (error) {
    const stderr = (error as { stderr?: Buffer | string }).stderr?.toString().trim();
    die(stderr ? `${cmd} ${args.join(" ")} failed:\n${stderr}` : `${cmd} ${args.join(" ")} failed`);
  }
}

function cloneSource(source: GithubSource, dest: string, sparseDirs?: string[]): string {
  const dirs = sparseDirs ?? (source.dir === "." ? [] : [source.dir]);
  const cloneArgs = ["clone", "--filter=blob:none", ...(dirs.length > 0 ? ["--sparse"] : []), githubUrl(source), dest];
  run("git", cloneArgs);
  if (dirs.length > 0) run("git", ["-C", dest, "sparse-checkout", "set", ...dirs]);
  if (source.ref) {
    run("git", ["-C", dest, "fetch", "--depth", "1", "origin", source.ref]);
    run("git", ["-C", dest, "checkout", "FETCH_HEAD"]);
    if (dirs.length > 0) run("git", ["-C", dest, "sparse-checkout", "reapply"]);
  }
  return run("git", ["-C", dest, "rev-parse", "HEAD"]);
}

function readStructuredFile(path: string): unknown {
  const raw = readFileSync(path, "utf8");
  try {
    return path.endsWith(".json") ? JSON.parse(raw) : yamlParse(raw);
  } catch (error) {
    die(`Invalid ${path}: ${error}`);
  }
}

function findFirstExisting(baseDir: string, candidates: string[]): string | undefined {
  return candidates.map((candidate) => join(baseDir, candidate)).find((path) => existsSync(path));
}

function readMetadata(dir: string): ExtensionMetadata {
  const path = findFirstExisting(dir, METADATA_FILES);
  if (!path) die(`Missing extension metadata in ${dir}. Expected one of: ${METADATA_FILES.join(", ")}`);

  const metadata = readStructuredFile(path) as ExtensionMetadata;

  if (!metadata.name || !/^[a-zA-Z0-9_-]+$/.test(metadata.name)) {
    die(`${path}: "name" must contain only letters, digits, _ and -`);
  }
  if (!metadata.entry) die(`${path}: "entry" is required`);
  if (metadata.entry.startsWith("/") || metadata.entry.includes("..")) {
    die(`${path}: "entry" must be a relative path inside the extension`);
  }

  return metadata;
}

function readCatalog(repoDir: string): ExtensionCatalog {
  const path = findFirstExisting(repoDir, CATALOG_FILES);
  if (!path) die(`Missing extension index. Expected one of: ${CATALOG_FILES.join(", ")}`);
  const catalog = readStructuredFile(path) as ExtensionCatalog;
  if (!Array.isArray(catalog.extensions)) die(`${path}: "extensions" must be an array`);

  const extensions = catalog.extensions.map((entry, index) => {
    if (!entry.name || !/^[a-zA-Z0-9_-]+$/.test(entry.name)) {
      die(`${path}: extensions[${index}].name must contain only letters, digits, _ and -`);
    }
    if (!entry.dir) die(`${path}: extensions[${index}].dir is required`);
    return {
      ...entry,
      dir: normalizeDir(entry.dir),
    };
  });
  return { extensions };
}

function extensionPathIsInstallIgnored(path: string): boolean {
  return path.split("/").some((part) => INSTALL_IGNORE_NAMES.has(part));
}

function copyRuntimeSource(sourceDir: string, destDir: string): void {
  cpSync(sourceDir, destDir, {
    recursive: true,
    filter: (sourcePath) => !extensionPathIsInstallIgnored(relative(sourceDir, sourcePath)),
  });
}

function writeRuntimePackage(destDir: string, metadata: ExtensionMetadata): void {
  const dependencies = metadata.runtime?.dependencies ?? {};
  const pkg = {
    private: true,
    type: "module",
    dependencies,
  };
  writeFileSync(join(destDir, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
}

function installDeps(destDir: string, metadata: ExtensionMetadata, noDeps: boolean): void {
  const dependencies = metadata.runtime?.dependencies ?? {};
  if (noDeps || Object.keys(dependencies).length === 0) return;
  run("npm", ["install", "--omit=dev", "--silent"], destDir);
}

function manifestPathToDir(manifestPath: string): string {
  return dirname(manifestPath);
}

function readManifest(manifestPath: string): { extensions: ExtensionEntry[] } {
  if (!existsSync(manifestPath)) return { extensions: [] };
  const parsed = yamlParse(readFileSync(manifestPath, "utf8")) as { extensions?: ExtensionEntry[] } | null;
  return { extensions: Array.isArray(parsed?.extensions) ? parsed.extensions : [] };
}

function writeManifest(manifestPath: string, manifest: { extensions: ExtensionEntry[] }): void {
  mkdirSync(dirname(manifestPath), { recursive: true });
  writeFileSync(manifestPath, yamlStringify(manifest), "utf8");
}

function normalizeContributes(contributes: ContributesSpec | undefined): ContributesSpec {
  return {
    commands: contributes?.commands ?? [],
    targetTypes: contributes?.targetTypes ?? [],
    hooks: contributes?.hooks ?? [],
    outputFormats: contributes?.outputFormats ?? [],
    ...(contributes?.initOrder !== undefined ? { initOrder: contributes.initOrder } : {}),
  };
}

export function buildManifestEntry(name: string, metadata: ExtensionMetadata, enabled = true): ExtensionEntry {
  return {
    name,
    path: name,
    entry: metadata.entry,
    enabled,
    contributes: normalizeContributes(metadata.contributes),
  };
}

function upsertManifestEntry(manifestPath: string, entry: ExtensionEntry, preserveEnabled = false): ExtensionEntry {
  const manifest = readManifest(manifestPath);
  const index = manifest.extensions.findIndex((e) => e.name === entry.name);
  if (index >= 0) {
    const previous = manifest.extensions[index];
    if (!previous) die(`Cannot update manifest entry "${entry.name}"`);
    manifest.extensions[index] = {
      ...entry,
      enabled: preserveEnabled ? (previous.enabled ?? true) : entry.enabled,
    };
  } else {
    manifest.extensions.push(entry);
  }
  writeManifest(manifestPath, manifest);
  return index >= 0 ? (manifest.extensions[index] ?? entry) : entry;
}

function removeManifestEntry(manifestPath: string, name: string): boolean {
  const manifest = readManifest(manifestPath);
  const before = manifest.extensions.length;
  manifest.extensions = manifest.extensions.filter((entry) => entry.name !== name);
  writeManifest(manifestPath, manifest);
  return manifest.extensions.length !== before;
}

async function confirmUnlessYes(yes: boolean | undefined, message: string): Promise<void> {
  if (yes) return;
  if (!process.stdin.isTTY) die(`${message}\nRe-run with --yes to confirm.`);

  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = await rl.question(`${message} [y/N] `);
    if (!/^y(es)?$/i.test(answer.trim())) die("Cancelled.");
  } finally {
    rl.close();
  }
}

function findCatalogEntry(catalog: ExtensionCatalog, token: string): CatalogEntry | undefined {
  const index = Number(token);
  if (Number.isInteger(index) && index >= 1 && index <= catalog.extensions.length) {
    return catalog.extensions[index - 1];
  }
  return catalog.extensions.find((entry) => entry.name === token);
}

async function selectCatalogEntries(catalog: ExtensionCatalog, parsed: ParsedArgs): Promise<CatalogEntry[]> {
  const selected = flagString(parsed.flags, "select");
  if (flagBool(parsed.flags, "all")) return catalog.extensions;

  if (selected) {
    const entries = selected
      .split(",")
      .map((token) => token.trim())
      .filter(Boolean)
      .map((token) => {
        const entry = findCatalogEntry(catalog, token);
        if (!entry) die(`Extension "${token}" not found in index`);
        return entry;
      });
    return [...new Map(entries.map((entry) => [entry.name, entry])).values()];
  }

  if (!process.stdin.isTTY) {
    die("Repository extension index has multiple extensions. Re-run with --all or --select <name[,name]>.");
  }

  const selectedNames = await multiselect<string>({
    message: "Select extensions to install",
    options: catalog.extensions.map((entry, index) => ({
      value: entry.name,
      label: `${index + 1}. ${entry.name}`,
      ...(entry.description ? { hint: entry.description } : {}),
    })),
    required: true,
    input: process.stdin,
    output: process.stderr,
  });

  if (isCancel(selectedNames)) die("Cancelled.");
  if (selectedNames.length === 0) die("No extensions selected.");

  const byName = new Map(catalog.extensions.map((entry) => [entry.name, entry]));
  return selectedNames.map((name) => {
    const entry = byName.get(name);
    if (!entry) die(`Extension "${name}" not found in index`);
    return entry;
  });
}

function printInstallSummary(params: {
  action: "install" | "update";
  name: string;
  source: GithubSource;
  metadata: ExtensionMetadata;
  installDir: string;
  resolvedCommit: string;
}): void {
  const contributes = normalizeContributes(params.metadata.contributes);
  const dependencies = params.metadata.runtime?.dependencies ?? {};
  console.log(
    [
      `Extension ${params.action}: ${params.name}`,
      `source: github:${params.source.owner}/${params.source.repo}`,
      `dir: ${params.source.dir}`,
      `ref: ${params.source.ref ?? "(default branch)"}`,
      `commit: ${params.resolvedCommit}`,
      `entry: ${params.metadata.entry}`,
      `install_dir: ${params.installDir}`,
      `commands: ${(contributes.commands ?? []).join(", ") || "-"}`,
      `hooks: ${(contributes.hooks ?? []).join(", ") || "-"}`,
      `target_types: ${(contributes.targetTypes ?? []).map((t) => (typeof t === "string" ? t : t.name)).join(", ") || "-"}`,
      `dependencies: ${Object.keys(dependencies).join(", ") || "-"}`,
    ].join("\n"),
  );
}

function readInstallRecord(installDir: string): InstallRecord {
  const path = join(installDir, INSTALL_RECORD_FILE);
  if (!existsSync(path)) die(`No ${INSTALL_RECORD_FILE} found in ${installDir}`);
  try {
    return JSON.parse(readFileSync(path, "utf8")) as InstallRecord;
  } catch (error) {
    die(`Invalid ${path}: ${error}`);
  }
}

async function installFromGithub(manifestPath: string, options: InstallOptions): Promise<void> {
  const manifestDir = manifestPathToDir(manifestPath);
  const tmpRoot = mkdtempSync(join(tmpdir(), "clip-ext-install-"));
  const cloneDir = join(tmpRoot, "repo");

  try {
    const resolvedCommit = cloneSource(options.source, cloneDir);
    const sourceDir = join(cloneDir, options.source.dir);
    if (!existsSync(sourceDir)) die(`Extension directory not found: ${options.source.dir}`);

    const metadata = readMetadata(sourceDir);
    const name = options.name ?? metadata.name;
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) die(`Invalid extension name: "${name}"`);

    const installDir = join(manifestDir, name);
    const stagingDir = join(manifestDir, `.install-${name}-${Date.now()}`);
    if (existsSync(installDir) && !options.force) {
      die(`Extension "${name}" already exists at ${installDir}. Use --force to overwrite.`);
    }

    printInstallSummary({
      action: options.update ? "update" : "install",
      name,
      source: options.source,
      metadata,
      installDir,
      resolvedCommit,
    });

    await confirmUnlessYes(options.yes, `${options.update ? "Update" : "Install"} extension "${name}"?`);

    rmSync(stagingDir, { recursive: true, force: true });
    copyRuntimeSource(sourceDir, stagingDir);
    writeRuntimePackage(stagingDir, metadata);
    installDeps(stagingDir, metadata, options.noDeps === true);

    const oldEnabled = readManifest(manifestPath).extensions.find((entry) => entry.name === name)?.enabled;
    const manifestEntry = buildManifestEntry(name, metadata, oldEnabled ?? true);
    const installRecord: InstallRecord = {
      schemaVersion: 1,
      name,
      ...(metadata.version ? { version: metadata.version } : {}),
      installedAt: new Date().toISOString(),
      source: { ...options.source, resolvedCommit },
      manifestEntry,
    };
    writeFileSync(join(stagingDir, INSTALL_RECORD_FILE), `${JSON.stringify(installRecord, null, 2)}\n`, "utf8");

    rmSync(installDir, { recursive: true, force: true });
    renameSync(stagingDir, installDir);
    upsertManifestEntry(manifestPath, manifestEntry, options.update === true);
    console.log(`${options.update ? "Updated" : "Installed"} extension "${name}".`);
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
}

async function installFromGithubCatalog(manifestPath: string, source: GithubSource, parsed: ParsedArgs): Promise<void> {
  const tmpRoot = mkdtempSync(join(tmpdir(), "clip-ext-index-"));
  const cloneDir = join(tmpRoot, "repo");

  try {
    const resolvedCommit = cloneSource(source, cloneDir, [".clip", "clip"]);
    const catalog = readCatalog(cloneDir);
    const selected = await selectCatalogEntries(catalog, parsed);
    console.log(`Extension index: github:${source.owner}/${source.repo}`);
    console.log(`commit: ${resolvedCommit}`);
    console.log(`selected: ${selected.map((entry) => entry.name).join(", ")}`);

    for (const entry of selected) {
      await installFromGithub(manifestPath, {
        source: { ...source, dir: entry.dir },
        force: flagBool(parsed.flags, "force"),
        yes: flagBool(parsed.flags, "yes"),
        noDeps: flagBool(parsed.flags, "no-deps"),
      });
    }
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
}

export async function cmdInstall(manifestPath: string, args: string[]): Promise<void> {
  const parsed = parseArgs(args);
  const spec = parsed.rest[0];
  if (!spec)
    die(
      "Usage: clip ext install <github-spec> [--dir <extension-dir> | --all | --select names] [--ref ref] [--yes] [--force]",
    );

  const source = parseGithubSource(spec, {
    dir: flagString(parsed.flags, "dir"),
    ref: flagString(parsed.flags, "ref"),
  });

  if (!flagString(parsed.flags, "dir") && source.dir === ".") {
    await installFromGithubCatalog(manifestPath, source, parsed);
    return;
  }

  await installFromGithub(manifestPath, {
    source,
    name: flagString(parsed.flags, "name"),
    force: flagBool(parsed.flags, "force"),
    yes: flagBool(parsed.flags, "yes"),
    noDeps: flagBool(parsed.flags, "no-deps"),
  });
}

export async function cmdUpdate(manifestPath: string, args: string[]): Promise<void> {
  const parsed = parseArgs(args);
  const name = parsed.rest[0];
  if (!name) die("Usage: clip ext update <name> [--ref ref] [--yes] [--no-deps]");

  const installDir = join(manifestPathToDir(manifestPath), name);
  const record = readInstallRecord(installDir);
  const source = {
    ...record.source,
    ...(flagString(parsed.flags, "ref") ? { ref: flagString(parsed.flags, "ref") } : {}),
  };
  await installFromGithub(manifestPath, {
    source,
    name,
    force: true,
    yes: flagBool(parsed.flags, "yes"),
    noDeps: flagBool(parsed.flags, "no-deps"),
    update: true,
  });
}

export async function cmdUninstall(manifestPath: string, args: string[]): Promise<void> {
  const parsed = parseArgs(args);
  const name = parsed.rest[0];
  if (!name) die("Usage: clip ext uninstall <name> --yes");

  await confirmUnlessYes(flagBool(parsed.flags, "yes"), `Uninstall extension "${name}"?`);

  const installDir = join(manifestPathToDir(manifestPath), name);
  const removedManifest = removeManifestEntry(manifestPath, name);
  rmSync(installDir, { recursive: true, force: true });
  console.log(
    removedManifest
      ? `Uninstalled extension "${name}".`
      : `Removed files for "${name}". Manifest entry was not present.`,
  );
}

export function cmdInfo(manifestPath: string, args: string[]): void {
  const name = args[0];
  if (!name) die("Usage: clip ext info <name>");

  const installDir = join(manifestPathToDir(manifestPath), name);
  const record = readInstallRecord(installDir);
  console.log(JSON.stringify(record, null, 2));
}
