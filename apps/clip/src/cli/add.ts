import type { Registry } from "@clip/core";
import { die } from "@clip/core";

const RESERVED_VALUE_FLAGS = new Set(["allow", "deny", "type"]);

export async function runAdd(args: string[], registry: Registry): Promise<void> {
  const name = args[0];
  if (!name || name.startsWith("--")) {
    die("Usage: clip add <name> <command-or-url> [--allow x,y] [--deny z]");
  }

  const reservedNames = new Set(registry.listInternalVerbs());
  if (reservedNames.has(name)) {
    die(`"${name}" is a reserved command name and cannot be used as a target.`);
  }

  const boolFlags = registry.listBooleanFlags();
  const positionals: string[] = [];
  const flags: Record<string, string> = {};

  for (let i = 1; i < args.length; i++) {
    const a = args[i] ?? "";
    if (a.startsWith("--")) {
      const key = a.slice(2);
      if (boolFlags.has(key)) {
        flags[key] = "true";
      } else {
        const val = args[i + 1];
        if (val !== undefined && !val.startsWith("--")) {
          flags[key] = val;
          i++;
        } else if (RESERVED_VALUE_FLAGS.has(key)) {
          die(`--${key} requires a value`);
        } else {
          flags[key] = "true";
        }
      }
    } else {
      positionals.push(a);
    }
  }

  const allow = flags["allow"] ? flags["allow"].split(",").map((s) => s.trim()) : undefined;
  const deny = flags["deny"] ? flags["deny"].split(",").map((s) => s.trim()) : undefined;

  const addArgs = { name, positionals, flags, allow, deny };

  // --type 명시: 직접 dispatch
  const explicitType = flags["type"];
  if (explicitType) {
    const contribution = registry.getContribution(explicitType);
    if (contribution?.addHandler) {
      await contribution.addHandler(addArgs);
      return;
    }
    die(`Unknown type: "${explicitType}". Check registered target types.`);
  }

  // identifyFlags 순회 (dispatchPriority 오름차순)
  for (const contribution of registry.listContributionsByPriority()) {
    const identified = contribution.argSpec?.identifyFlags?.some((f) => flags[f] !== undefined);
    if (identified && contribution.addHandler) {
      await contribution.addHandler(addArgs);
      return;
    }
  }

  // positional → urlHeuristic 순회 (URL/non-URL 모두 동일 경로, priority 순)
  const firstPositional = positionals[0];
  if (firstPositional) {
    for (const contribution of registry.listContributionsByPriority()) {
      if (contribution.urlHeuristic?.(firstPositional) && contribution.addHandler) {
        await contribution.addHandler(addArgs);
        return;
      }
    }
  }

  die("Cannot detect type. Provide <command-or-url> or --type <type>");
}
