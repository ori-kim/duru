import type { Registry } from "@clip/core";
import { loadConfig } from "@clip/core";
import type { ListOpts, ListRow } from "@clip/core";
import { listBound } from "../commands/bind.ts";
import { BUILTIN_DESC, classifyInternalVerbs } from "./internal-verbs.ts";

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
    // listRowRenderer가 있으면 섹션 단위로 폭을 계산해 테이블처럼 렌더링한다.
    if (contribution.listRowRenderer) {
      const headerLine = await getHeaderLine(type, contribution, entries[0]?.[1], opts);
      console.log(headerLine);
      const sorted = [...entries].sort(([a], [b]) => a.localeCompare(b));
      const rows = await Promise.all(
        sorted.map(([name, target]) => contribution.listRowRenderer?.(name, target, opts)),
      );
      for (const line of formatListRows(rows, opts)) console.log(line);
    } else if (contribution.listRenderer) {
      // 헤더 출력: 첫 번째 entry로 헤더 색상 추론
      const headerLine = await getHeaderLine(type, contribution, entries[0]?.[1], opts);
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
    const rows: ListRow[] = [];
    for (const [name, cfg] of Object.entries(targets).sort(([a], [b]) => a.localeCompare(b))) {
      const desc =
        typeof cfg === "object" && cfg !== null && "description" in cfg
          ? (cfg as { description: string }).description
          : "";
      rows.push({
        name,
        nameColor: "35",
        subject: desc,
        markers: bound.has(name) ? ["bind"] : undefined,
      });
    }
    for (const line of formatListRows(rows, opts)) console.log(line);
  }

  const { builtin, extensions } = classifyInternalVerbs(registry, phase1Verbs);

  if (extensions.length > 0) {
    if (!first) console.log();
    first = false;
    const cx = (text: string) => c("38;2;180;141;173", text);
    console.log(cx("── extensions ──"));
    const rows = extensions.map((v) => ({
      name: v,
      nameColor: "38;2;180;141;173",
      subject: registry.getCommandDesc(v) ?? "",
    }));
    for (const line of formatListRows(rows, opts)) console.log(line);
  }

  if (builtin.length > 0) {
    if (!first) console.log();
    first = false;
    console.log("── builtin ──");
    const rows = builtin.map((v) => ({ name: v, subject: BUILTIN_DESC[v] ?? "" }));
    for (const line of formatListRows(rows, opts)) console.log(line);
  }

  if (first) {
    // 아무것도 없음
    console.log("No targets configured.");
    console.log("\nAdd one:\n  clip add <name> <command>          # CLI tool");
    console.log("  clip add <name> <https://...>      # MCP server");
    console.log("  clip add <name> <https://.../openapi.json> --api  # OpenAPI REST API");
    console.log("  clip add <name> <host:port> --grpc  # gRPC server");
    console.log("  clip add <name> <https://.../graphql> --graphql  # GraphQL API");
  }
}

export function formatListRows(rows: ListRow[], opts: Pick<ListOpts, "color">): string[] {
  if (rows.length === 0) return [];

  const nameWidth = Math.max(16, ...rows.map((row) => row.name.length));
  const subjectWidth = Math.max(0, ...rows.map((row) => row.subject?.length ?? 0));
  const profileWidth = Math.max(0, ...rows.map((row) => row.profile?.length ?? 0));
  const statusWidth = Math.max(0, ...rows.map((row) => (row.status ? `[${row.status}]`.length : 0)));
  const markersWidth = Math.max(
    0,
    ...rows.map((row) => (row.markers?.length ? row.markers.map((m) => `[${m}]`).join(" ").length : 0)),
  );

  const hasSubject = subjectWidth > 0;
  const hasProfile = profileWidth > 0;
  const hasStatus = statusWidth > 0;
  const hasMarkers = markersWidth > 0;
  const hasDetail = rows.some((row) => row.detail);

  return rows.map((row) => {
    const nameText = row.name.padEnd(nameWidth);
    const name = row.nameColor ? opts.color(row.nameColor, nameText) : nameText;
    const cols = [name];

    if (hasSubject) cols.push((row.subject ?? "").padEnd(subjectWidth));
    if (hasProfile) cols.push((row.profile ?? "").padEnd(profileWidth));
    if (hasStatus) {
      const status = row.status ? `[${row.status}]` : "";
      cols.push(opts.color("2", status.padEnd(statusWidth)));
    }
    if (hasMarkers) {
      const markers = row.markers?.length ? row.markers.map((m) => `[${m}]`).join(" ") : "";
      cols.push(opts.color("2", markers.padEnd(markersWidth)));
    }
    if (hasDetail && row.detail) cols.push(row.detail);

    return `  ${cols.join("  ")}`.trimEnd();
  });
}

async function getHeaderLine(
  type: string,
  contribution: import("@clip/core").TargetTypeContribution,
  _firstTarget: unknown,
  opts: ListOpts,
): Promise<string> {
  const code = contribution.displayHint?.headerColor ?? "35";
  return opts.color(code, `── ${type} ──`);
}
