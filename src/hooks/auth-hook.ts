import { getStoredAuthHeaders, refreshIfExpiring } from "../commands/oauth.ts";
import type { ClipExtension } from "../extension.ts";

type AuthKind = "mcp" | "api" | "grpc" | "graphql";

export const authHookExtension: ClipExtension = {
  name: "builtin:auth",
  init(api) {
    api.registerHook(
      "beforeExecute",
      async (ctx) => {
        const t = ctx.target as { auth?: unknown; oauth?: boolean };
        if (t.auth !== "oauth" && !t.oauth) return;
        const kind = ctx.targetType as AuthKind;
        await refreshIfExpiring(ctx.targetName, kind);
        const stored = await getStoredAuthHeaders(ctx.targetName, kind);
        if (!stored || Object.keys(stored).length === 0) return;
        return { headers: { ...stored, ...ctx.headers } }; // ctx.headers 우선
      },
      { match: { type: ["api", "mcp", "graphql", "grpc"] } },
    );
  },
};
