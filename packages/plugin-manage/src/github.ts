import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type DiscoveredPlugin, discoverPluginsInDir } from "./scan.ts";

export type GitHubSource = {
  owner: string;
  repo: string;
  ref: string; // branch/tag/commit — "HEAD" means default branch
  subpath: string; // e.g. "plugins" → scan repo/plugins/ for plugin dirs
};

// Supported URL formats:
//   https://github.com/owner/repo
//   https://github.com/owner/repo/tree/main
//   https://github.com/owner/repo/tree/main/plugins/my-plugin
//   owner/repo              (shorthand, uses default branch)
//   owner/repo@ref          (shorthand with explicit ref)
export function parseGitHubUrl(input: string): GitHubSource | null {
  const trimmed = input.trim();

  // Local paths: absolute, relative (./  ../), or single segment without @
  if (
    trimmed.startsWith("/") ||
    trimmed.startsWith("./") ||
    trimmed.startsWith("../") ||
    trimmed === "." ||
    trimmed === ".."
  ) {
    return null;
  }

  if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://")) {
    // Shorthand: owner/repo or owner/repo@ref — must contain exactly one "/" (owner/repo)
    // or more with a subpath, but never start with a dot or slash.
    const repoParts = trimmed.split("/");
    if (repoParts.length < 2) return null;
    const [ownerPart, repoPart, ...subParts] = repoParts;
    if (!ownerPart || !repoPart) return null;
    // owner@ref/repo is not valid — only owner/repo@ref or owner/repo
    const atInRepo = repoPart.indexOf("@");
    if (atInRepo >= 0) {
      return {
        owner: ownerPart,
        repo: repoPart.slice(0, atInRepo),
        ref: repoPart.slice(atInRepo + 1),
        subpath: subParts.join("/"),
      };
    }
    return { owner: ownerPart, repo: repoPart, ref: "HEAD", subpath: subParts.join("/") };
  }

  // Full GitHub URL
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.hostname !== "github.com") return null;

  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length < 2) return null;
  const [owner, repo, maybeTree, ref, ...subpathParts] = parts;
  if (!owner || !repo) return null;

  // /owner/repo/tree/ref/subpath
  if (maybeTree === "tree" && ref) {
    return { owner, repo, ref, subpath: subpathParts.join("/") };
  }

  // /owner/repo only
  return { owner, repo, ref: "HEAD", subpath: "" };
}

export type FetchResult = {
  plugins: DiscoveredPlugin[];
  cleanup(): Promise<void>;
};

// Download the GitHub repo tarball, extract to a temp dir, and scan for plugins.
// Caller must call cleanup() when done to remove the temp dir.
export async function fetchGitHubPlugins(source: GitHubSource): Promise<FetchResult> {
  const tarballUrl = `https://api.github.com/repos/${source.owner}/${source.repo}/tarball/${source.ref}`;

  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "duru-plugin-manager",
  };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  const res = await fetch(tarballUrl, { headers });
  if (!res.ok) {
    throw new Error(
      `GitHub API error ${res.status}: ${res.statusText}\nURL: ${tarballUrl}\n${res.status === 404 ? "Repository not found or is private." : ""}`,
    );
  }

  const tmpRoot = mkdtempSync(join(tmpdir(), "duru-plugin-src-"));
  const tarFile = join(tmpRoot, "source.tar.gz");
  const extractDir = join(tmpRoot, "extracted");
  await mkdir(extractDir, { recursive: true });

  // Write tarball to disk
  writeFileSync(tarFile, new Uint8Array(await res.arrayBuffer()));

  // Extract — GitHub tarball has a single top-level directory like `owner-repo-sha/`
  const tar = spawnSync("tar", ["xzf", tarFile, "-C", extractDir, "--strip-components=1"], {
    stdio: "pipe",
  });
  rmSync(tarFile, { force: true });

  if (tar.status !== 0) {
    await rm(tmpRoot, { recursive: true, force: true });
    throw new Error(`tar extraction failed:\n${tar.stderr?.toString()}`);
  }

  const scanDir = source.subpath ? join(extractDir, source.subpath) : extractDir;
  const plugins = await discoverPluginsInDir(scanDir);

  return {
    plugins,
    cleanup: () => rm(tmpRoot, { recursive: true, force: true }),
  };
}
