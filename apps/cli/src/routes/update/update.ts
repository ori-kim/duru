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

const REPO = "ori-kim/duru";

export type UpdateOptions = {
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
  assets: ReleaseAsset[];
};

export type UpdateDeps = {
  fetch: typeof fetch;
  execPath: string;
  platform: NodeJS.Platform;
  arch: string;
  currentVersion: string;
  stdout: { write(chunk: string): unknown };
  stderr: { write(chunk: string): unknown };
  confirm: (message: string) => Promise<boolean>;
  runQuiet: (cmd: string, args: string[]) => void;
};

function die(message: string): never {
  throw new Error(message);
}

function defaultConfirm(message: string): Promise<boolean> {
  if (!process.stdin.isTTY) {
    die("Refusing to update non-interactively without --yes.");
  }
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  return rl.question(`${message} [y/N] `).then((answer) => {
    rl.close();
    return answer.trim().toLowerCase() === "y" || answer.trim().toLowerCase() === "yes";
  });
}

export const defaultDeps: UpdateDeps = {
  fetch,
  execPath: process.execPath,
  platform: process.platform,
  arch: process.arch,
  currentVersion: process.env["DURU_VERSION"] ?? "dev",
  stdout: process.stdout,
  stderr: process.stderr,
  confirm: defaultConfirm,
  runQuiet: (cmd, args) => {
    const { spawnSync } = require("node:child_process") as typeof import("node:child_process");
    spawnSync(cmd, args, { stdio: "ignore" });
  },
};

export function compareVersions(a: string, b: string): number {
  const left = a.replace(/^v/, "").split(".").map(Number);
  const right = b.replace(/^v/, "").split(".").map(Number);
  const max = Math.max(left.length, right.length);
  for (let i = 0; i < max; i++) {
    const l = Number.isFinite(left[i] ?? NaN) ? (left[i] as number) : 0;
    const r = Number.isFinite(right[i] ?? NaN) ? (right[i] as number) : 0;
    if (l !== r) return l > r ? 1 : -1;
  }
  return 0;
}

export function assetNameFor(platform: NodeJS.Platform, arch: string): string {
  if (platform !== "darwin") {
    die(`Unsupported OS "${platform}". duru update currently supports macOS only.`);
  }
  if (arch === "arm64") return "duru-darwin-arm64";
  if (arch === "x64") return "duru-darwin-x64";
  die(`Unsupported architecture "${arch}".`);
}

export function selfUpdatePath(execPath: string): string {
  const base = basename(execPath);
  if (base === "bun" || base === "node") {
    die("duru update requires a compiled duru binary. Dev installs should be updated via git.");
  }
  if (!base.startsWith("duru")) {
    die(`Refusing to replace non-duru executable: ${execPath}`);
  }
  return execPath;
}

function releaseApiUrl(tag: string | undefined): string {
  const suffix = tag ? `releases/tags/${tag}` : "releases/latest";
  return `https://api.github.com/repos/${REPO}/${suffix}`;
}

async function fetchRelease(tag: string | undefined, deps: UpdateDeps): Promise<GithubRelease> {
  const res = await deps.fetch(releaseApiUrl(tag), {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "duru-updater" },
  });
  if (!res.ok) die(`Failed to fetch release metadata (${res.status} ${res.statusText}).`);
  const release = (await res.json()) as GithubRelease;
  if (!release.tag_name || !Array.isArray(release.assets)) {
    die("Release metadata is missing tag or assets.");
  }
  return release;
}

function findAsset(release: GithubRelease, name: string): ReleaseAsset {
  const asset = release.assets.find((a) => a.name === name);
  if (!asset) die(`Release ${release.tag_name} does not include ${name}.`);
  return asset;
}

async function downloadText(url: string, deps: UpdateDeps): Promise<string> {
  const res = await deps.fetch(url, { headers: { "User-Agent": "duru-updater" } });
  if (!res.ok) die(`Failed to download ${url} (${res.status} ${res.statusText}).`);
  return res.text();
}

async function downloadFile(url: string, path: string, deps: UpdateDeps): Promise<void> {
  const res = await deps.fetch(url, { headers: { "User-Agent": "duru-updater" } });
  if (!res.ok) die(`Failed to download ${url} (${res.status} ${res.statusText}).`);
  writeFileSync(path, new Uint8Array(await res.arrayBuffer()));
}

function parseSha256(text: string): string {
  const match = text.match(/\b[a-fA-F0-9]{64}\b/);
  if (!match) die("Downloaded checksum file does not contain a SHA-256 hash.");
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
    die(`Cannot write to ${path}. Re-run with an install path owned by this user.`);
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

export async function runUpdate(options: UpdateOptions, deps: UpdateDeps = defaultDeps): Promise<void> {
  const assetName = assetNameFor(deps.platform, deps.arch);
  const release = await fetchRelease(options.tag, deps);
  const asset = findAsset(release, assetName);
  const checksumAsset = findAsset(release, `${assetName}.sha256`);
  const currentTag = deps.currentVersion.startsWith("v") ? deps.currentVersion : `v${deps.currentVersion}`;
  const relation = compareVersions(release.tag_name, currentTag);

  if (options.check) {
    const status = relation > 0 ? "update available" : relation === 0 ? "up to date" : "selected is older";
    deps.stdout.write(`current: ${currentTag}\nlatest:  ${release.tag_name}\nstatus:  ${status}\n`);
    return;
  }

  if (!options.force && relation === 0) {
    deps.stdout.write(`duru is already at ${currentTag}.\n`);
    return;
  }
  if (!options.force && !options.tag && relation < 0) {
    deps.stdout.write(`duru ${currentTag} is newer than ${release.tag_name}.\n`);
    return;
  }

  const currentPath = selfUpdatePath(deps.execPath);

  if (options.dryRun) {
    deps.stdout.write(
      [
        `current: ${currentTag}`,
        `target:  ${release.tag_name}`,
        `asset:   ${asset.name}`,
        `path:    ${currentPath}`,
        "action:  replace local duru binary",
      ].join("\n") + "\n",
    );
    return;
  }

  assertWritable(currentPath);
  if (!options.yes) {
    const ok = await deps.confirm(`Update duru ${currentTag} → ${release.tag_name}?`);
    if (!ok) {
      deps.stdout.write("Update cancelled.\n");
      return;
    }
  }

  const tmpRoot = mkdtempSync(join(tmpdir(), "duru-update-"));
  const tmpBinary = join(tmpRoot, asset.name);
  try {
    const expectedHash = parseSha256(await downloadText(checksumAsset.browser_download_url, deps));
    await downloadFile(asset.browser_download_url, tmpBinary, deps);
    const actualHash = sha256File(tmpBinary);
    if (actualHash !== expectedHash) {
      die(`Checksum mismatch. Expected ${expectedHash}, got ${actualHash}.`);
    }
    prepareBinary(tmpBinary, deps);
    replaceBinary(currentPath, tmpBinary);
    deps.stdout.write(`Updated duru ${currentTag} → ${release.tag_name}\n${currentPath}\n`);
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
}
