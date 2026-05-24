import { createDuruFileHome } from "@duru/file-store";
import { virtualPlugin } from "@duru/virtual-plugins";
import { createContextStore } from "./store.ts";
import type { CaptureRecord, ContextState } from "./types.ts";

export { createContextStore };
export type { CaptureRecord, ContextState };
export type { ContextStore } from "./store.ts";

type ContextPluginConfig = {
  commands?: readonly string[];
};

async function readConfig(files: ReturnType<ReturnType<typeof createDuruFileHome>["store"]>): Promise<ContextPluginConfig> {
  return (await files.read<ContextPluginConfig>("config.json")) ?? {};
}

function serializeResult(value: unknown): string {
  if (value === undefined || value === null) return "";
  const seen = new WeakSet<object>();
  try {
    return JSON.stringify(value, (_key, item: unknown) => {
      if (typeof item === "bigint") return `${item.toString()}n`;
      if (typeof item === "object" && item !== null) {
        if (seen.has(item)) return "[Circular]";
        seen.add(item);
      }
      return item;
    });
  } catch { return String(value); }
}

/**
 * context-mode 플러그인 — DURU_HOME/context에서 독립적으로 의존성을 구성한다.
 *
 * contributes: { commands: [context, ctx], eager: true }
 * eager: true → 캡처 미들웨어 때문에 항상 로드
 */
export default virtualPlugin(async (cli) => {
  const home = createDuruFileHome({ env: process.env });
  const store = createContextStore(home.scope("context"));
  const config = await readConfig(home.store());

  cli.option("--context-mode", "Capture this invocation to context history");

  cli.use(async (ctx, next) => {
    const cmd = ctx.request.positionals[0];
    const isContextCmd = cmd === "context" || cmd === "ctx";
    if (isContextCmd) return next();
    const opts = ctx.options as { contextMode?: boolean };
    const enabled = Boolean(opts.contextMode) || (config.commands?.includes(cmd ?? "") ?? false);
    if (!enabled) return next();
    const at = new Date().toISOString();
    try {
      const result = await next();
      await store.append({ at, argv: ctx.request.argv, status: "ok", text: serializeResult(result) });
      return result;
    } catch (err) {
      await store.append({ at, argv: ctx.request.argv, status: "error", text: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  });

  cli
    .command("context [...query]")
    .group("Context")
    .meta({ description: "Show or search captured invocation history" })
    .action(async (ctx) => {
      const query = (ctx.params.query as string[] | undefined)?.join(" ") ?? "";
      if (query) { const matches = await store.search(query); return ctx.exit(0, { query, matches }, true); }
      const captures = await store.list();
      return ctx.exit(0, { captures }, true);
    });

  cli
    .command("ctx [...query]")
    .group("Context")
    .meta({ description: "Search captured invocation history" })
    .action(async (ctx) => {
      const query = (ctx.params.query as string[] | undefined)?.join(" ") ?? "";
      const matches = await store.search(query);
      return ctx.exit(0, { query, matches }, true);
    });
});
