import { virtualPlugin } from "@duru/virtual-plugins";
import { createContextStore } from "./store.ts";
import type { ContextStore } from "./store.ts";
import type { CaptureRecord, ContextState } from "./types.ts";

export { createContextStore };
export type { CaptureRecord, ContextState, ContextStore };

export function contextModePlugin(store: ContextStore) {
  return virtualPlugin(async (cli) => {
    // duru context           → list all captures
    // duru context <query>   → search captures
    // duru ctx <query>       → search alias
    cli
      .command("context [...query]")
      .group("Context")
      .meta({ description: "Show or search captured invocation history" })
      .action(async (ctx) => {
        const query = (ctx.params.query as string[] | undefined)?.join(" ") ?? "";
        if (query) {
          const matches = await store.search(query);
          return ctx.exit(0, { query, matches }, true);
        }
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
}
