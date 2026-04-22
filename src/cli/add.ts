import type { Registry } from "../extension.ts";
import { die } from "../utils/errors.ts";

export async function runAdd(args: string[], registry: Registry): Promise<void> {
  const name = args[0];
  if (!name || name.startsWith("--")) {
    die("Usage: clip add <name> <command-or-url> [--allow x,y] [--deny z]");
  }

  // RESERVED_NAMES: registry에 등록된 internal verb 목록으로 동적화
  const reservedNames = new Set(registry.listInternalVerbs());
  if (reservedNames.has(name)) {
    die(`"${name}" is a reserved command name and cannot be used as a target.`);
  }

  const positionals: string[] = [];
  const flags: Record<string, string> = {};
  const BOOL_FLAGS = new Set(["stdio", "sse", "api", "grpc", "graphql", "plaintext", "script", "global"]);
  for (let i = 1; i < args.length; i++) {
    const a = args[i] ?? "";
    if (a.startsWith("--")) {
      const key = a.slice(2);
      if (BOOL_FLAGS.has(key)) {
        flags[key] = "true";
      } else {
        const val = args[i + 1];
        if (val !== undefined && !val.startsWith("--")) {
          flags[key] = val;
          i++;
        } else {
          die(`--${key} requires a value`);
        }
      }
    } else {
      positionals.push(a);
    }
  }

  const allow = flags["allow"] ? flags["allow"].split(",").map((s) => s.trim()) : undefined;
  const deny = flags["deny"] ? flags["deny"].split(",").map((s) => s.trim()) : undefined;
  const addOpts = flags["global"] ? { global: true } : undefined;

  const addArgs = { name, positionals, flags, allow, deny, addOpts };

  // --type 플래그가 명시된 경우: 해당 contribution의 addHandler를 직접 호출
  const explicitType = flags["type"];
  if (explicitType) {
    const contribution = registry.getContribution(explicitType);
    if (contribution?.addHandler) {
      await contribution.addHandler(addArgs);
      return;
    }
    die(`Unknown type: "${explicitType}". Check registered target types.`);
  }

  // 타입 판별 플래그 우선 처리
  if (flags["graphql"]) {
    const contribution = registry.getContribution("graphql");
    if (contribution?.addHandler) { await contribution.addHandler(addArgs); return; }
  }
  if (flags["grpc"]) {
    const contribution = registry.getContribution("grpc");
    if (contribution?.addHandler) { await contribution.addHandler(addArgs); return; }
  }
  if (flags["api"]) {
    const contribution = registry.getContribution("api");
    if (contribution?.addHandler) { await contribution.addHandler(addArgs); return; }
  }
  if (flags["script"]) {
    const contribution = registry.getContribution("script");
    if (contribution?.addHandler) { await contribution.addHandler(addArgs); return; }
  }
  if (flags["url"] || flags["stdio"] || flags["sse"]) {
    const contribution = registry.getContribution("mcp");
    if (contribution?.addHandler) { await contribution.addHandler(addArgs); return; }
  }
  if (flags["command"]) {
    const contribution = registry.getContribution("cli");
    if (contribution?.addHandler) { await contribution.addHandler(addArgs); return; }
  }

  // URL 휴리스틱: positionals[0]을 URL로 분석해 타입 판별
  const firstPositional = positionals[0];
  if (firstPositional) {
    const isUrl = firstPositional.startsWith("http://") || firstPositional.startsWith("https://");
    if (isUrl) {
      // contribution 순서대로 urlHeuristic 조회 (graphql → api → mcp 우선순위)
      const contributions = registry.listContributions();
      // graphql, api를 먼저 체크 (더 구체적인 패턴)
      const ordered = [
        ...contributions.filter((c) => c.type === "graphql"),
        ...contributions.filter((c) => c.type === "api"),
        ...contributions.filter((c) => c.type !== "graphql" && c.type !== "api"),
      ];
      for (const contribution of ordered) {
        if (contribution.urlHeuristic?.(firstPositional) && contribution.addHandler) {
          await contribution.addHandler(addArgs);
          return;
        }
      }
    } else {
      // URL이 아니면 cli fallback
      const contribution = registry.getContribution("cli");
      if (contribution?.addHandler) { await contribution.addHandler(addArgs); return; }
    }
  }

  die("Cannot detect type. Provide <command-or-url> or --type <type>");
}
