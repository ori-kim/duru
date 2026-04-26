import { listBound } from "../commands/bind.ts";
import type { Registry } from "@clip/core";
import { loadConfig } from "@clip/core";
import { classifyInternalVerbs, BUILTIN_DESC } from "./internal-verbs.ts";

export async function runList(registry: Registry, phase1Verbs?: Set<string>): Promise<void> {
  const config = await loadConfig(registry);
  const bound = new Set(await listBound());
  const tty = process.stdout.isTTY;
  const c = (code: string, text: string) => (tty ? `\x1b[${code}m${text}\x1b[0m` : text);
  const bind = (name: string) => (bound.has(name) ? c("2", " [bind]") : "");

  const opts = { bound, tty, color: c, bind };

  // contribution이 등록된 타입들을 priority 순서대로 렌더링
  const contributions = registry.listContributionsByPriority();
  let first = true;

  for (const contribution of contributions) {
    const { type } = contribution;
    const entries = Object.entries((config.targets[type] ?? {}) as Record<string, unknown>);
    if (entries.length === 0) continue;

    if (!first) console.log();
    first = false;

    // contribution에 정의된 색상 코드를 가져오기 위해 listRenderer에서 색상을 추론하거나
    // 헤더 색상은 type별로 contribution이 알고 있다. 헤더는 일단 generic으로 출력.
    // listRenderer가 있으면 각 entry를 렌더링
    if (contribution.listRenderer) {
      // 헤더 출력: 첫 번째 entry로 헤더 색상 추론
      const headerLine = await getHeaderLine(type, contribution, entries[0]![1], opts);
      console.log(headerLine);
      const sorted = [...entries].sort(([a], [b]) => a.localeCompare(b));
      for (const [name, target] of sorted) {
        const line = await contribution.listRenderer(name, target, opts);
        console.log(line);
      }
    } else {
      // fallback: generic 렌더링
      console.log(c("35", `── ${type} ──`));
      const sorted = [...entries].sort(([a], [b]) => a.localeCompare(b));
      for (const [name, cfg] of sorted) {
        const desc =
          typeof cfg === "object" && cfg !== null && "description" in cfg
            ? ` — ${(cfg as { description: string }).description}`
            : "";
        console.log(`  ${c("35", name.padEnd(16))}${desc}${bind(name)}`);
      }
    }
  }

  // _ext: contribution 없는 확장 타입들
  const registeredTypes = new Set(contributions.map((c) => c.type));
  const extEntries = Object.entries(config._ext ?? {}).filter(
    ([extType, m]) => !registeredTypes.has(extType) && Object.keys(m).length > 0,
  );
  for (const [extType, targets] of extEntries) {
    if (!first) console.log();
    first = false;
    console.log(c("35", `── ${extType} ──`));
    for (const [name, cfg] of Object.entries(targets).sort(([a], [b]) => a.localeCompare(b))) {
      const desc =
        typeof cfg === "object" && cfg !== null && "description" in cfg
          ? ` — ${(cfg as { description: string }).description}`
          : "";
      console.log(`  ${c("35", name.padEnd(16))}${desc}${bind(name)}`);
    }
  }

  const { builtin, extensions } = classifyInternalVerbs(registry, phase1Verbs);

  if (extensions.length > 0) {
    if (!first) console.log();
    first = false;
    const cx = (text: string) => c("38;2;180;141;173", text);
    console.log(cx("── extensions ──"));
    for (const v of extensions) {
      const desc = registry.getInternalCommandDesc(v) ?? "";
      console.log(`  ${cx(v.padEnd(16))}${desc}`);
    }
  }

  if (builtin.length > 0) {
    if (!first) console.log();
    first = false;
    console.log("── builtin ──");
    for (const v of builtin) {
      const desc = BUILTIN_DESC[v] ?? "";
      console.log(`  ${v.padEnd(16)}${desc}`);
    }
  }

  if (first) {
    // 아무것도 없음
    console.log("No targets configured.");
    console.log(`\nAdd one:\n  clip add <name> <command>          # CLI tool`);
    console.log(`  clip add <name> <https://...>      # MCP server`);
    console.log(`  clip add <name> <https://.../openapi.json> --api  # OpenAPI REST API`);
    console.log(`  clip add <name> <host:port> --grpc  # gRPC server`);
    console.log(`  clip add <name> <https://.../graphql> --graphql  # GraphQL API`);
  }
}

async function getHeaderLine(
  type: string,
  contribution: import("@clip/core").TargetTypeContribution,
  _firstTarget: unknown,
  opts: import("@clip/core").ListOpts,
): Promise<string> {
  const code = contribution.displayHint?.headerColor ?? "35";
  return opts.color(code, `── ${type} ──`);
}
