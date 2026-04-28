import type { ExtensionApi } from "@clip/core";
import { readFileSync, existsSync, writeFileSync, unlinkSync, readdirSync, mkdirSync } from "fs";

const RECAP_DIR = `${process.env.CLIP_HOME || process.env.HOME + "/.clip"}/recap`;

// ─── Helpers (sync) ───

function readIndex(targetName: string): any[] {
  const path = `${RECAP_DIR}/${targetName}/index.json`;
  if (!existsSync(path)) return [];
  try { return JSON.parse(readFileSync(path, "utf-8")); }
  catch { return []; }
}

function readBody(targetName: string, file: string): string {
  const path = `${RECAP_DIR}/${targetName}/reference/${file}`;
  if (!existsSync(path)) return "";
  try { return readFileSync(path, "utf-8"); }
  catch { return ""; }
}

function writeIndex(targetName: string, entries: any[]): void {
  const dir = `${RECAP_DIR}/${targetName}`;
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(`${dir}/index.json`, JSON.stringify(entries, null, 2));
}

function getActiveProfile(targetName: string): string | null {
  const configPath = `${process.env.CLIP_HOME || process.env.HOME + "/.clip"}/target/mcp/${targetName}/config.yml`;
  if (!existsSync(configPath)) return null;
  try {
    const content = readFileSync(configPath, "utf-8");
    const match = content.match(/active:\s*"?([^"\n]+)"?/);
    return match ? match[1].trim() : null;
  } catch { return null; }
}

function resolveTarget(targetName: string): string {
  if (existsSync(`${RECAP_DIR}/${targetName}`)) return targetName;
  const profile = getActiveProfile(targetName);
  if (profile) {
    const withProfile = `${targetName}@${profile}`;
    if (existsSync(`${RECAP_DIR}/${withProfile}`)) return withProfile;
  }
  return targetName;
}

function getTargets(): string[] {
  try {
    return readdirSync(RECAP_DIR, { withFileTypes: true })
      .filter((d: any) => d.isDirectory())
      .map((d: any) => d.name);
  } catch { return []; }
}

function getRegisteredTargetNames(): Set<string> {
  const root = `${process.env.CLIP_HOME || process.env.HOME + "/.clip"}/target`;
  const names = new Set<string>();
  try {
    for (const type of readdirSync(root, { withFileTypes: true })) {
      if (!type.isDirectory()) continue;
      for (const t of readdirSync(`${root}/${type.name}`, { withFileTypes: true })) {
        if (t.isDirectory()) names.add(t.name);
      }
    }
  } catch {}
  return names;
}

// ─── Render helpers ───

function renderRecap(targetName: string, key?: string, jsonMode = false) {
  const resolved = resolveTarget(targetName);
  const entries = readIndex(resolved);

  if (entries.length === 0) {
    return jsonMode
      ? { shortCircuit: { exitCode: 0, stdout: "[]", stderr: "" } }
      : { shortCircuit: { exitCode: 0, stdout: `No recap found for '${resolved}'\n`, stderr: "" } };
  }

  if (key) {
    const entry = entries.find((e: any) => e.name === key);
    if (!entry) {
      return jsonMode
        ? { shortCircuit: { exitCode: 0, stdout: "null", stderr: "" } }
        : { shortCircuit: { exitCode: 1, stdout: "", stderr: `Error: '${key}' not found in '${resolved}'\n` } };
    }
    const body = readBody(resolved, entry.file);
    if (jsonMode) {
      return { shortCircuit: { exitCode: 0, stdout: JSON.stringify({ key, description: entry.description, value: body }), stderr: "" } };
    }
    return { shortCircuit: { exitCode: 0, stdout: `📄 ${resolved} / ${key}\n─────────────────────────────────────\n${body}\n`, stderr: "" } };
  }

  if (jsonMode) {
    const result = entries.map((e: any) => ({
      key: e.name,
      description: e.description,
      value: readBody(resolved, e.file),
      updatedAt: e.updatedAt,
    }));
    return { shortCircuit: { exitCode: 0, stdout: JSON.stringify(result, null, 2), stderr: "" } };
  }

  let output = `🧠 Recap for '${resolved}':\n\n`;
  for (const e of entries) {
    output += `📌 ${e.name}\n   ${e.description}\n`;
    const body = readBody(resolved, e.file);
    const lines = body.trim().split("\n").slice(0, 3);
    for (const line of lines) {
      if (line.trim()) output += `   → ${line.trim().slice(0, 80)}\n`;
    }
    output += "\n";
  }
  return { shortCircuit: { exitCode: 0, stdout: output, stderr: "" } };
}

function renderGroupSection(name: string): string {
  const entries = readIndex(name);
  let s = `📋 Recap for '${name}':\n\n`;
  for (const e of entries) {
    s += `  • ${e.name}\n    ${e.description}\n    updated: ${e.updatedAt}\n\n`;
  }
  return s;
}

// ─── Management handlers ───

function handleAdd(targetName: string, args: string[]) {
  const resolved = resolveTarget(targetName);
  const parsed: Record<string, string> = {};
  let i = 0;
  while (i < args.length) {
    const a = args[i];
    if (a.startsWith("--")) {
      const next = args[i + 1];
      if (next && !next.startsWith("--")) {
        parsed[a] = next;
        i += 2;
      } else {
        parsed[a] = "true";
        i++;
      }
    } else {
      i++;
    }
  }

  const name = parsed["--name"];
  const description = parsed["--description"];
  const body = parsed["--body"];

  if (!name || !description || !body) {
    return { shortCircuit: { exitCode: 1, stdout: "", stderr: "Usage: clip <target> recap add --name <name> --description <desc> --body <body>\n" } };
  }

  const dir = `${RECAP_DIR}/${resolved}`;
  const refDir = `${dir}/reference`;
  if (!existsSync(refDir)) {
    mkdirSync(refDir, { recursive: true });
  }
  writeFileSync(`${refDir}/${name}.md`, body + "\n");

  const existing = readIndex(resolved);
  const now = new Date().toISOString();
  const filtered = existing.filter((e: any) => e.name !== name);
  filtered.push({ name, description, updatedAt: now, file: `${name}.md` });
  writeIndex(resolved, filtered);

  return { shortCircuit: { exitCode: 0, stdout: `✅ Recap '${name}' added to '${resolved}'\n`, stderr: "" } };
}

function handleList(targetName: string | undefined) {
  if (targetName) {
    const resolved = resolveTarget(targetName);
    const entries = readIndex(resolved);
    if (entries.length === 0) {
      return { shortCircuit: { exitCode: 0, stdout: `No recap found for: ${resolved}\n`, stderr: "" } };
    }
    let output = `📋 Recap for '${resolved}':\n\n`;
    for (const e of entries) {
      output += `  • ${e.name}\n    ${e.description}\n    updated: ${e.updatedAt}\n\n`;
    }
    return { shortCircuit: { exitCode: 0, stdout: output, stderr: "" } };
  }

  const dirs = getTargets();
  if (dirs.length === 0) {
    return { shortCircuit: { exitCode: 0, stdout: "No recap found.\n", stderr: "" } };
  }

  const registered = getRegisteredTargetNames();
  const targets: string[] = [];
  const bundles: string[] = [];
  for (const d of dirs) {
    if (readIndex(d).length === 0) continue;
    (registered.has(d) ? targets : bundles).push(d);
  }
  targets.sort();
  bundles.sort();

  let output = "";
  if (targets.length > 0) {
    output += "── Targets ──\n\n";
    for (const t of targets) output += renderGroupSection(t);
  }
  if (bundles.length > 0) {
    if (output) output += "\n";
    output += "── Bundles ──\n\n";
    for (const b of bundles) output += renderGroupSection(b);
  }
  return { shortCircuit: { exitCode: 0, stdout: output || "No recap found.\n", stderr: "" } };
}

function handleShow(targetName: string, args: string[]) {
  const resolved = resolveTarget(targetName);
  const isJson = args.includes("--json-output");
  const key = args.find((a, i) => i === 0 && !a.startsWith("--")) || args.find((a) => !a.startsWith("--"));
  return renderRecap(targetName, key, isJson);
}

function handleDelete(targetName: string, name: string) {
  const resolved = resolveTarget(targetName);
  const file = `${RECAP_DIR}/${resolved}/reference/${name}.md`;
  if (!existsSync(file)) {
    return { shortCircuit: { exitCode: 1, stdout: "", stderr: `Error: '${name}' not found in '${resolved}'\n` } };
  }
  unlinkSync(file);

  const existing = readIndex(resolved);
  const filtered = existing.filter((e: any) => e.name !== name);
  writeIndex(resolved, filtered);

  return { shortCircuit: { exitCode: 0, stdout: `🗑️  Recap '${name}' deleted from '${resolved}'\n`, stderr: "" } };
}

function handleSearch(keyword: string, targetFilter?: string) {
  if (!keyword) {
    return { shortCircuit: { exitCode: 1, stdout: "", stderr: "Error: search keyword required\n" } };
  }

  const targets = targetFilter ? [targetFilter] : getTargets();
  const results: string[] = [];
  const re = new RegExp(keyword, "i");

  for (const t of targets) {
    const entries = readIndex(t);
    for (const e of entries) {
      if (re.test(e.name) || re.test(e.description)) {
        results.push(`${t}|${e.name}|${e.description}|meta`);
      }
      const body = readBody(t, e.file);
      if (re.test(body) && !results.some((r) => r.startsWith(`${t}|${e.name}|`))) {
        results.push(`${t}|${e.name}|${e.description}|body`);
      }
    }
  }

  if (results.length === 0) {
    return { shortCircuit: { exitCode: 0, stdout: `No results found for '${keyword}'\n`, stderr: "" } };
  }

  let output = `🔍 Results for '${keyword}':\n\n`;
  for (const r of results) {
    const [t, n, desc, src] = r.split("|");
    output += `  • ${t} / ${n}\n    ${desc}\n`;
    if (src === "body") output += "    (found in body)\n";
    output += "\n";
  }
  return { shortCircuit: { exitCode: 0, stdout: output, stderr: "" } };
}

// ─── Extension ───

function printResult(r: ReturnType<typeof renderRecap>): void {
  if (!("shortCircuit" in r)) return;
  if (r.shortCircuit.stdout) process.stdout.write(r.shortCircuit.stdout);
  if (r.shortCircuit.stderr) process.stderr.write(r.shortCircuit.stderr);
  if (r.shortCircuit.exitCode !== 0) process.exit(r.shortCircuit.exitCode);
}

export const extension = {
  name: "recap",
  init(api: ExtensionApi) {
    // clip recap [target|subcommand] [...] — global entry point
    // clip recap                → list all targets/bundles (grouped)
    // clip recap <target>       → render recap for target
    // clip recap <target> <key> → look up specific entry
    // clip recap list [target]  → list entries
    // clip recap search <kw>    → search across all entries
    api.registerInternalCommand("recap", async ({ args }) => {
      const first = args[0];

      if (!first) {
        printResult(handleList(undefined));
        return;
      }

      if (first === "list") {
        printResult(handleList(args[1]));
        return;
      }

      if (first === "search") {
        let keyword = "";
        let targetFilter: string | undefined;
        let i = 1;
        while (i < args.length) {
          if (args[i]!.startsWith("--target=")) {
            targetFilter = args[i]!.slice("--target=".length);
            i++;
          } else if (args[i] === "--target") {
            targetFilter = args[i + 1];
            i += 2;
          } else {
            keyword = args[i]!;
            i++;
          }
        }
        printResult(handleSearch(keyword, targetFilter));
        return;
      }

      // clip recap <target> [key] [--json]
      const isJson = args.includes("--json-output");
      const key = args.slice(1).find((a) => !a.startsWith("--"));
      printResult(renderRecap(first, key, isJson));
    }, {
      description: "query and manage stored tacit knowledge",
      completion: () => `
  if (( CURRENT == 3 )); then
    local recap_dir="\${CLIP_HOME:-$HOME/.clip}/recap"
    local -a rtargets=()
    for d in "$recap_dir/"*(N/); do
      rtargets+=("\${d:t}")
    done
    local -a subcmds=(
      'list:list entries (all or for a target)'
      'search:search across all entries'
    )
    (( \${#rtargets} )) && _describe -t recap-targets 'recap targets' rtargets
    _describe -t recap-commands 'recap commands' subcmds
  fi`,
    });

    api.registerHook("beforeExecute", (ctx) => {
      if (ctx.subcommand !== "recap") return;

      const targetName = ctx.targetName;
      const args = ctx.args;

      // Default: show recap for this target
      if (args.length === 0 || args[0].startsWith("--")) {
        const isJson = args.includes("--json-output");
        const key = args.find((a) => !a.startsWith("--"));
        return renderRecap(targetName, key, isJson);
      }

      const subCmd = args[0];
      const rest = args.slice(1);

      switch (subCmd) {
        case "add":
          return handleAdd(targetName, rest);

        case "list": {
          const listTarget = rest[0] || targetName;
          return handleList(listTarget);
        }

        case "show":
          return handleShow(targetName, rest);

        case "delete": {
          const name = rest[0];
          if (!name) {
            return { shortCircuit: { exitCode: 1, stdout: "", stderr: "Usage: clip <target> recap delete <name>\n" } };
          }
          return handleDelete(targetName, name);
        }

        case "search": {
          let keyword = "";
          let targetFilter: string | undefined;
          let i = 0;
          while (i < rest.length) {
            if (rest[i].startsWith("--target=")) {
              targetFilter = rest[i].slice("--target=".length);
              i++;
            } else if (rest[i] === "--target") {
              targetFilter = rest[i + 1];
              i += 2;
            } else {
              keyword = rest[i];
              i++;
            }
          }
          return handleSearch(keyword, targetFilter);
        }

        default:
          return { shortCircuit: {
            exitCode: 1,
            stdout: "",
            stderr: `Unknown recap subcommand: ${subCmd}\nUsage: clip <target> recap {add|list|show|delete|search}\n`
          } };
      }
    });
  },
};
