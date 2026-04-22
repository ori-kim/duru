import { listBound } from "../commands/bind.ts";
import type { Registry } from "../extension.ts";
import { getActiveWorkspace, loadConfig } from "../config.ts";

export async function runList(registry: Registry): Promise<void> {
  const config = await loadConfig();
  const bound = new Set(await listBound());
  const activeWs = getActiveWorkspace();
  const tty = process.stdout.isTTY;
  const c = (code: string, text: string) => (tty ? `\x1b[${code}m${text}\x1b[0m` : text);
  const wsTag = (name: string) => {
    if (!activeWs) return "";
    const src = config._sources?.[name];
    return src !== undefined ? c("2", src ? ` [${src}]` : " [global]") : "";
  };
  const bind = (name: string) => (bound.has(name) ? c("2", " [bind]") : "");

  const opts = { bound, activeWorkspace: activeWs, tty, color: c, wsTag, bind };

  // contribution이 등록된 타입들을 순서대로 렌더링
  const contributions = registry.listContributions();
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

// type별 헤더 색상은 contribution이 알고 있으나 현재 API에 노출되지 않음.
// contribution의 listRenderer가 첫 줄에 헤더를 포함하지 않으므로 헤더는 여기서 생성한다.
// type → ANSI 색상 코드 매핑 (builtin 타입들과 일치해야 함)
const TYPE_HEADER_COLORS: Record<string, string> = {
  cli:     "32",
  mcp:     "33",
  api:     "36",
  grpc:    "1;34",
  graphql: "38;5;205",
  script:  "38;5;245",
};

async function getHeaderLine(
  type: string,
  _contribution: import("../extension.ts").TargetTypeContribution,
  _firstTarget: unknown,
  opts: import("../extension.ts").ListOpts,
): Promise<string> {
  const code = TYPE_HEADER_COLORS[type] ?? "35";
  return opts.color(code, `── ${type} ──`);
}
