import { type ProfileOverride, getTarget, loadConfig, updateTarget } from "@clip/core";
import { die } from "@clip/core";

// --- Types ---

export type HasProfiles = {
  profiles?: Record<string, ProfileOverride>;
  active?: string;
};

// --- Merge ---

export function applyOverride<T extends HasProfiles>(target: T, override: ProfileOverride): T {
  const merged: Record<string, unknown> = { ...target };
  for (const [key, val] of Object.entries(override)) {
    if (val === undefined) continue;
    if ((key === "env" || key === "headers" || key === "metadata") && typeof val === "object") {
      // 병합: target 기본값 위에 profile 값 덮어씀
      merged[key] = { ...((target[key as keyof T] as object | undefined) ?? {}), ...val };
    } else {
      merged[key] = val;
    }
  }
  return merged as T;
}

export function resolveProfile<T extends HasProfiles>(
  target: T,
  explicit?: string,
): { merged: T; profileName?: string } {
  const name = explicit ?? target.active;
  if (!name) return { merged: target };
  const p = target.profiles?.[name];
  if (!p) die(`Profile "${name}" not found. Run: clip profile list <target>`);
  return { merged: applyOverride(target, p), profileName: name };
}

// --- Commands ---

async function runProfileAdd(args: string[]): Promise<void> {
  const [targetName, profileName, ...rest] = args;
  if (!targetName || !profileName)
    die("Usage: clip profile add <target> <profile> [--args a,b] [--url ...] [--env K=V ...]");

  const flags: Record<string, string | string[] | Record<string, string>> = {};
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i]!;
    const val = rest[i + 1];
    if (flag === "--args" && val) {
      flags["args"] = val.split(",").map((s) => s.trim());
      i++;
    } else if (flag === "--url" && val) {
      flags["url"] = val;
      i++;
    } else if (flag === "--command" && val) {
      flags["command"] = val;
      i++;
    } else if (flag === "--endpoint" && val) {
      flags["endpoint"] = val;
      i++;
    } else if (flag === "--address" && val) {
      flags["address"] = val;
      i++;
    } else if (flag === "--base-url" && val) {
      flags["baseUrl"] = val;
      i++;
    } else if (flag === "--openapi-url" && val) {
      flags["openapiUrl"] = val;
      i++;
    } else if (flag === "--env" && val) {
      const [k, v] = val.split("=", 2);
      if (!k || v === undefined) die(`--env must be KEY=VALUE, got: ${val}`);
      flags["env"] = { ...((flags["env"] as Record<string, string> | undefined) ?? {}), [k]: v };
      i++;
    } else if (flag === "--header" && val) {
      const [k, v] = val.split(":", 2);
      if (!k || v === undefined) die(`--header must be KEY:VALUE, got: ${val}`);
      flags["headers"] = { ...((flags["headers"] as Record<string, string> | undefined) ?? {}), [k.trim()]: v.trim() };
      i++;
    } else if (flag === "--metadata" && val) {
      const [k, v] = val.split("=", 2);
      if (!k || v === undefined) die(`--metadata must be KEY=VALUE, got: ${val}`);
      flags["metadata"] = { ...((flags["metadata"] as Record<string, string> | undefined) ?? {}), [k]: v };
      i++;
    }
  }

  if (Object.keys(flags).length === 0) die("Specify at least one override flag (e.g. --args, --url, --env).");

  await updateTarget(targetName, (raw) => {
    const profiles = (raw["profiles"] as Record<string, unknown> | undefined) ?? {};
    profiles[profileName] = flags;
    return { ...raw, profiles };
  });
  console.log(`Profile "${profileName}" added to target "${targetName}".`);
}

async function runProfileRemove(args: string[]): Promise<void> {
  const [targetName, profileName] = args;
  if (!targetName || !profileName) die("Usage: clip profile remove <target> <profile>");

  await updateTarget(targetName, (raw) => {
    const profiles = (raw["profiles"] as Record<string, unknown> | undefined) ?? {};
    if (!(profileName in profiles)) die(`Profile "${profileName}" not found on target "${targetName}".`);
    delete profiles[profileName];
    const next: Record<string, unknown> = { ...raw, profiles };
    if (raw["active"] === profileName) delete next["active"];
    return next;
  });
  console.log(`Profile "${profileName}" removed from target "${targetName}".`);
}

async function runProfileList(args: string[]): Promise<void> {
  const [targetName] = args;
  if (!targetName) die("Usage: clip profile list <target>");

  const cfg = await loadConfig();
  const { target } = getTarget(cfg, targetName);
  const t = target as HasProfiles;
  const profiles = t.profiles ?? {};
  const active = t.active;
  const names = Object.keys(profiles);

  if (names.length === 0) {
    console.log(`No profiles on "${targetName}".`);
    console.log(`\nAdd one:\n  clip profile add ${targetName} <profile> --args "exec,<profile>,--,gh"`);
    return;
  }

  console.log(`Profiles for "${targetName}":`);
  for (const name of names.sort()) {
    const marker = name === active ? " (active)" : "";
    const p = profiles[name]!;
    const detail = p.args ? `args: [${p.args.join(", ")}]` : (p.url ?? p.address ?? p.endpoint ?? p.baseUrl ?? "");
    console.log(`  ${name}${marker}  — ${detail}`);
  }
}

async function runProfileUse(args: string[]): Promise<void> {
  const [targetName, profileName] = args;
  if (!targetName || !profileName) die("Usage: clip profile use <target> <profile>");

  await updateTarget(targetName, (raw) => {
    const profiles = (raw["profiles"] as Record<string, unknown> | undefined) ?? {};
    if (!(profileName in profiles)) die(`Profile "${profileName}" not found on target "${targetName}".`);
    return { ...raw, active: profileName };
  });
  console.log(`Active profile for "${targetName}" set to "${profileName}".`);
}

async function runProfileUnset(args: string[]): Promise<void> {
  const [targetName] = args;
  if (!targetName) die("Usage: clip profile unset <target>");

  await updateTarget(targetName, (raw) => {
    const next = { ...raw };
    delete next["active"];
    return next;
  });
  console.log(`Active profile unset for "${targetName}".`);
}

export async function runProfileCmd(args: string[]): Promise<void> {
  const sub = args[0];
  const rest = args.slice(1);
  if (sub === "add") await runProfileAdd(rest);
  else if (sub === "remove") await runProfileRemove(rest);
  else if (sub === "list") await runProfileList(rest);
  else if (sub === "use") await runProfileUse(rest);
  else if (sub === "unset") await runProfileUnset(rest);
  else {
    console.log("Usage: clip profile <add|remove|list|use|unset> ...");
    console.log("  clip profile add <target> <profile> [--args a,b,c] [--url ...] [--env K=V]");
    console.log("  clip profile remove <target> <profile>");
    console.log("  clip profile list <target>");
    console.log("  clip profile use <target> <profile>");
    console.log("  clip profile unset <target>");
    console.log("\nOne-shot override: clip <target>@<profile> <args>");
  }
}
