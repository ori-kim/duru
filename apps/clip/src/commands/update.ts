import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  constants,
  accessSync,
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { die } from "@clip/core";
import { VERSION } from "../cli/help.ts";

const DEFAULT_REPO = "ori-kim/cli-proxy";

type UpdateOptions = {
  check: boolean;
  dryRun: boolean;
  force: boolean;
  yes: boolean;
  tag?: string;
};

type ReleaseAsset = {
  name: string;
  browser_download_url: string;
};

type GithubRelease = {
  tag_name: string;
  html_url?: string;
  assets: ReleaseAsset[];
};

export type UpdateDeps = {
  fetch: typeof fetch;
  execPath: string;
  platform: NodeJS.Platform;
  arch: string;
  stdout: { write(chunk: string): unknown };
  stderr: { write(chunk: string): unknown };
  confirm: (message: string) => Promise<boolean>;
  runQuiet: (cmd: string, args: string[]) => void;
};

function defaultConfirm(message: string): Promise<boolean> {
  if (!process.stdin.isTTY) {
    die("Refusing to update non-interactively without --yes.", 1, "UPDATE_CONFIRM_REQUIRED");
  }
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  return rl.question(`${message} [y/N] `).then((answer) => {
    rl.close();
    return answer.trim().toLowerCase() === "y" || answer.trim().toLowerCase() === "yes";
  });
}

function defaultRunQuiet(cmd: string, args: string[]): void {
  spawnSync(cmd, args, { stdio: "ignore" });
}

const defaultDeps: UpdateDeps = {
  fetch,
  execPath: process.execPath,
  platform: process.platform,
  arch: process.arch,
  stdout: process.stdout,
  stderr: process.stderr,
  confirm: defaultConfirm,
  runQuiet: defaultRunQuiet,
};

function usage(): string {
  return [
    "Usage:",
    "  clip update [--check]",
    "  clip update [--version vX.Y.Z] [--yes] [--dry-run] [--force]",
    "",
    "Options:",
    "  --check             Show the latest available release without changing files",
    "  --version <tag>     Install a specific release tag",
    "  --yes, -y           Do not prompt before replacing the binary",
    "  --dry-run           Show what would change without downloading or replacing",
    "  --force             Reinstall even when the selected version matches the current version",
  ].join("\n");
}

export function parseUpdateArgs(args: string[]): UpdateOptions {
  const out: UpdateOptions = { check: false, dryRun: false, force: false, yes: false };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? "";
    if (arg === "--help" || arg === "-h") {
      throw new Error(usage());
    }
    if (arg === "--check") {
      out.check = true;
    } else if (arg === "--dry-run") {
      out.dryRun = true;
    } else if (arg === "--force") {
      out.force = true;
    } else if (arg === "--yes" || arg === "-y") {
      out.yes = true;
    } else if (arg === "--version") {
      const value = args[i + 1];
      if (!value) die("--version requires a release tag");
      out.tag = normalizeTag(value);
      i++;
    } else if (arg.startsWith("--version=")) {
      out.tag = normalizeTag(arg.slice("--version=".length));
    } else {
      die(`Unknown update option: ${arg}\n\n${usage()}`);
    }
  }

  return out;
}

function normalizeTag(raw: string): string {
  return raw.startsWith("v") ? raw : `v${raw}`;
}

export function compareVersions(a: string, b: string): number {
  const left = a.replace(/^v/, "").split(".").map(Number);
  const right = b.replace(/^v/, "").split(".").map(Number);
  const max = Math.max(left.length, right.length);
  for (let i = 0; i < max; i++) {
    const l = Number.isFinite(left[i]) ? (left[i] as number) : 0;
    const r = Number.isFinite(right[i]) ? (right[i] as number) : 0;
    if (l !== r) return l > r ? 1 : -1;
  }
  return 0;
}

export function assetNameFor(platform: NodeJS.Platform, arch: string): string {
  if (platform !== "darwin") {
    die(
      `Unsupported OS "${platform}". clip update currently supports macOS release assets only.`,
      1,
      "UPDATE_UNSUPPORTED_OS",
    );
  }
  if (arch === "arm64") return "clip-darwin-arm64";
  if (arch === "x64") return "clip-darwin-x64";
  die(`Unsupported architecture "${arch}".`, 1, "UPDATE_UNSUPPORTED_ARCH");
}

export function selfUpdatePath(execPath: string): string {
  const base = basename(execPath);
  if (base === "bun" || base === "node") {
    die(
      "clip update requires a compiled clip binary. Source and Bun installs should be updated with their package manager.",
      1,
      "UPDATE_NOT_COMPILED",
    );
  }
  if (!base.startsWith("clip")) {
    die(`Refusing to replace non-clip executable: ${execPath}`, 1, "UPDATE_NOT_CLIP_BINARY");
  }
  return execPath;
}

function releaseApiUrl(repo: string, tag: string | undefined): string {
  const suffix = tag ? `releases/tags/${tag}` : "releases/latest";
  return `https://api.github.com/repos/${repo}/${suffix}`;
}

async function fetchRelease(options: UpdateOptions, deps: UpdateDeps): Promise<GithubRelease> {
  const res = await deps.fetch(releaseApiUrl(DEFAULT_REPO, options.tag), {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "clip-updater",
    },
  });
  if (!res.ok) {
    die(`Failed to fetch release metadata (${res.status} ${res.statusText}).`, 1, "UPDATE_RELEASE_FETCH_FAILED");
  }
  const release = (await res.json()) as GithubRelease;
  if (!release.tag_name || !Array.isArray(release.assets)) {
    die("Release metadata is missing tag or assets.", 1, "UPDATE_RELEASE_INVALID");
  }
  return release;
}

function findAsset(release: GithubRelease, name: string): ReleaseAsset {
  const asset = release.assets.find((item) => item.name === name);
  if (!asset) {
    die(`Release ${release.tag_name} does not include ${name}.`, 1, "UPDATE_ASSET_MISSING");
  }
  return asset;
}

async function downloadText(url: string, deps: UpdateDeps): Promise<string> {
  const res = await deps.fetch(url, { headers: { "User-Agent": "clip-updater" } });
  if (!res.ok) die(`Failed to download ${url} (${res.status} ${res.statusText}).`, 1, "UPDATE_DOWNLOAD_FAILED");
  return await res.text();
}

async function downloadFile(url: string, path: string, deps: UpdateDeps): Promise<void> {
  const res = await deps.fetch(url, { headers: { "User-Agent": "clip-updater" } });
  if (!res.ok) die(`Failed to download ${url} (${res.status} ${res.statusText}).`, 1, "UPDATE_DOWNLOAD_FAILED");
  writeFileSync(path, new Uint8Array(await res.arrayBuffer()));
}

function parseSha256(text: string): string {
  const match = text.match(/\b[a-fA-F0-9]{64}\b/);
  if (!match) die("Downloaded checksum file does not contain a SHA-256 hash.", 1, "UPDATE_CHECKSUM_INVALID");
  return match[0].toLowerCase();
}

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function assertWritable(path: string): void {
  try {
    accessSync(path, constants.W_OK);
    accessSync(dirname(path), constants.W_OK);
  } catch {
    die(`Cannot write to ${path}. Re-run with an install path owned by this user.`, 1, "UPDATE_NOT_WRITABLE");
  }
}

function replaceBinary(currentPath: string, nextPath: string): void {
  const backupPath = `${currentPath}.bak-${Date.now()}`;
  renameSync(currentPath, backupPath);
  try {
    renameSync(nextPath, currentPath);
    rmSync(backupPath, { force: true });
  } catch (error) {
    if (!existsSync(currentPath) && existsSync(backupPath)) {
      renameSync(backupPath, currentPath);
    }
    throw error;
  }
}

function prepareBinary(path: string, deps: UpdateDeps): void {
  chmodSync(path, 0o755);
  if (deps.platform === "darwin") {
    deps.runQuiet("xattr", ["-cr", path]);
    deps.runQuiet("codesign", ["--force", "--sign", "-", path]);
  }
}

export async function runUpdate(args: string[], deps: UpdateDeps = defaultDeps): Promise<void> {
  let options: UpdateOptions;
  try {
    options = parseUpdateArgs(args);
  } catch (error) {
    if (error instanceof Error && error.message === usage()) {
      deps.stdout.write(`${usage()}\n`);
      return;
    }
    throw error;
  }

  const assetName = assetNameFor(deps.platform, deps.arch);
  const release = await fetchRelease(options, deps);
  const asset = findAsset(release, assetName);
  const checksumAsset = findAsset(release, `${assetName}.sha256`);
  const currentTag = `v${VERSION}`;
  const relation = compareVersions(release.tag_name, currentTag);

  if (options.check) {
    const status = relation > 0 ? "update available" : relation === 0 ? "up to date" : "selected release is older";
    deps.stdout.write(`current: ${currentTag}\nlatest:  ${release.tag_name}\nstatus:  ${status}\n`);
    return;
  }

  if (!options.force && relation === 0) {
    deps.stdout.write(`clip is already at ${currentTag}.\n`);
    return;
  }
  if (!options.force && !options.tag && relation < 0) {
    deps.stdout.write(`clip ${currentTag} is newer than ${release.tag_name}.\n`);
    return;
  }

  const currentPath = selfUpdatePath(deps.execPath);
  if (options.dryRun) {
    deps.stdout.write(
      `${[
        `current: ${currentTag}`,
        `target:  ${release.tag_name}`,
        `asset:   ${asset.name}`,
        `path:    ${currentPath}`,
        "action:  replace local clip binary",
      ].join("\n")}\n`,
    );
    return;
  }

  assertWritable(currentPath);
  if (!options.yes) {
    const ok = await deps.confirm(`Update clip ${currentTag} -> ${release.tag_name}?`);
    if (!ok) {
      deps.stdout.write("Update cancelled.\n");
      return;
    }
  }

  const tmpRoot = mkdtempSync(join(tmpdir(), "clip-update-"));
  const tmpBinary = join(tmpRoot, asset.name);
  try {
    const expectedHash = parseSha256(await downloadText(checksumAsset.browser_download_url, deps));
    await downloadFile(asset.browser_download_url, tmpBinary, deps);
    const actualHash = sha256File(tmpBinary);
    if (actualHash !== expectedHash) {
      die(`Checksum mismatch. Expected ${expectedHash}, got ${actualHash}.`, 1, "UPDATE_CHECKSUM_MISMATCH");
    }

    prepareBinary(tmpBinary, deps);
    replaceBinary(currentPath, tmpBinary);
    deps.stdout.write(`Updated clip ${currentTag} -> ${release.tag_name}\n`);
    deps.stdout.write(`${currentPath}\n`);
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
}
