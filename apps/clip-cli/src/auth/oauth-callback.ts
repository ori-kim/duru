import type { OAuthCallbackResult } from "@clip/auth";

export type WaitForLocalOAuthCallbackInput = {
  redirectUri: string;
  state: string;
  signal?: AbortSignal;
  timeoutMs?: number;
};

export function waitForLocalOAuthCallback(input: WaitForLocalOAuthCallbackInput): Promise<OAuthCallbackResult> {
  const redirectUrl = new URL(input.redirectUri);
  if (redirectUrl.protocol !== "http:") {
    throw new Error("OAuth callback redirectUri must use http for local callback handling");
  }
  if (!["127.0.0.1", "localhost"].includes(redirectUrl.hostname)) {
    throw new Error("OAuth callback redirectUri must use localhost or 127.0.0.1");
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => finish(reject, new Error("OAuth callback timed out")), input.timeoutMs ?? 120000);

    function finish<T>(complete: (value: T) => void, value: T): void {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      input.signal?.removeEventListener("abort", abort);
      server.stop(true);
      complete(value);
    }

    function abort(): void {
      finish(reject, new Error("OAuth callback aborted"));
    }

    input.signal?.addEventListener("abort", abort, { once: true });

    const server = Bun.serve({
      hostname: redirectUrl.hostname,
      port: Number(redirectUrl.port),
      fetch(request) {
        const url = new URL(request.url);
        if (url.pathname !== redirectUrl.pathname) return new Response("Not found", { status: 404 });

        const error = url.searchParams.get("error");
        if (error) {
          finish(reject, new Error(`OAuth callback returned error: ${error}`));
          return htmlResponse("Clip login failed. You can close this tab.");
        }

        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        if (!code || !state) {
          finish(reject, new Error("OAuth callback requires code and state"));
          return htmlResponse("Clip login failed. You can close this tab.");
        }
        if (state !== input.state) {
          finish(reject, new Error("OAuth callback state mismatch"));
          return htmlResponse("Clip login failed. You can close this tab.");
        }

        finish(resolve, { code, state });
        return htmlResponse("Clip login complete. You can close this tab.");
      },
    });
  });
}

function htmlResponse(message: string): Response {
  return new Response(`<!doctype html><meta charset="utf-8"><title>Clip</title><p>${escapeHtml(message)}</p>`, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
