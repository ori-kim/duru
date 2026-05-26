import type { OAuthCallbackResult } from "@duru/auth";
// @ts-expect-error — Bun embeds the file at build time via `with { type: "file" }`.
import embeddedIconPath from "../../../../assets/icon.png" with { type: "file" };

export type WaitForLocalOAuthCallbackInput = {
  redirectUri: string;
  state: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  iconPath?: string;
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
      complete(value);
      setTimeout(() => server.stop(true), 25);
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
        if (url.pathname === "/icon.png") return iconResponse(input.iconPath);
        if (url.pathname !== redirectUrl.pathname) return new Response("Not found", { status: 404 });

        const error = url.searchParams.get("error");
        if (error) {
          finish(reject, new Error(`OAuth callback returned error: ${error}`));
          return htmlResponse(
            {
              status: "failure",
              title: "Authentication failed",
              message: "Duru could not complete the login.",
              detail: url.searchParams.get("error_description") ?? error,
            },
            400,
          );
        }

        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        if (!code || !state) {
          finish(reject, new Error("OAuth callback requires code and state"));
          return htmlResponse(
            {
              status: "failure",
              title: "Authentication failed",
              message: "The OAuth callback did not include the required code and state.",
            },
            400,
          );
        }
        if (state !== input.state) {
          finish(reject, new Error("OAuth callback state mismatch"));
          return htmlResponse(
            {
              status: "failure",
              title: "Authentication failed",
              message: "The OAuth callback state did not match this login session.",
            },
            400,
          );
        }

        finish(resolve, { code, state });
        return htmlResponse({
          status: "success",
          title: "Authentication complete",
          message: "Duru is ready. You can close this tab and return to the terminal.",
        });
      },
    });
  });
}

function iconResponse(iconPath: string | undefined): Response {
  const file = Bun.file(iconPath ?? defaultIconPath());
  return new Response(file, {
    headers: {
      "content-type": "image/png",
      "cache-control": "no-store",
    },
  });
}

function defaultIconPath(): string {
  return embeddedIconPath;
}

function htmlResponse(
  page: { status: "success" | "failure"; title: string; message: string; detail?: string },
  status = 200,
): Response {
  const accent = page.status === "success" ? "#159947" : "#c2410c";
  const accentSoft = page.status === "success" ? "#e8f7ee" : "#fff1e9";
  const detail = page.detail ? `<p class="detail">${escapeHtml(page.detail)}</p>` : "";
  return new Response(
    `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Duru OAuth</title>
    <style>
      :root {
        color-scheme: light dark;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: #f6f7f9;
        color: #1f2933;
      }
      * { box-sizing: border-box; }
      body {
        min-height: 100vh;
        min-height: 100dvh;
        margin: 0;
        display: grid;
        place-items: center;
        padding: 48px 24px;
      }
      main {
        width: min(100%, 720px);
        display: flex;
        flex-direction: column;
        align-items: center;
        text-align: center;
      }
      .app-icon {
        width: 96px;
        height: 96px;
        border-radius: 24px;
        margin-bottom: 28px;
        box-shadow: 0 18px 48px rgb(15 23 42 / 18%);
      }
      .status {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        min-height: 40px;
        margin-bottom: 26px;
        padding: 0 18px;
        border-radius: 999px;
        background: ${accentSoft};
        color: ${accent};
        font-size: 16px;
        font-weight: 700;
        letter-spacing: 0;
      }
      .dot {
        width: 10px;
        height: 10px;
        border-radius: 50%;
        background: ${accent};
      }
      h1 {
        margin: 0 0 18px;
        font-size: 52px;
        line-height: 1.05;
        letter-spacing: 0;
      }
      p {
        width: min(100%, 640px);
        margin: 0;
        color: #536171;
        font-size: 24px;
        line-height: 1.45;
      }
      .detail {
        margin-top: 24px;
        padding: 16px 18px;
        border: 1px solid rgb(194 65 12 / 24%);
        border-radius: 8px;
        background: rgb(255 247 237 / 68%);
        color: #7c2d12;
        font-size: 15px;
        overflow-wrap: anywhere;
      }
      @media (max-width: 640px) {
        body { padding: 32px 18px; }
        main { width: min(100%, 440px); }
        .app-icon {
          width: 76px;
          height: 76px;
          border-radius: 18px;
          margin-bottom: 24px;
        }
        .status {
          min-height: 34px;
          margin-bottom: 20px;
          padding: 0 14px;
          font-size: 14px;
        }
        .dot {
          width: 8px;
          height: 8px;
        }
        h1 {
          margin-bottom: 12px;
          font-size: 34px;
          line-height: 1.1;
        }
        p {
          font-size: 18px;
          line-height: 1.45;
        }
      }
      @media (prefers-color-scheme: dark) {
        :root {
          background: #101418;
          color: #edf2f7;
        }
        p { color: #a8b3c1; }
        .app-icon { box-shadow: 0 18px 48px rgb(0 0 0 / 42%); }
        .detail {
          background: rgb(67 20 7 / 46%);
          border-color: rgb(251 146 60 / 26%);
          color: #fed7aa;
        }
      }
    </style>
  </head>
  <body>
    <main>
      <img class="app-icon" src="/icon.png" alt="Duru">
      <div class="status"><span class="dot"></span>${escapeHtml(page.status === "success" ? "Success" : "Failed")}</div>
      <h1>${escapeHtml(page.title)}</h1>
      <p>${escapeHtml(page.message)}</p>
      ${detail}
    </main>
  </body>
</html>`,
    {
      status,
      headers: { "content-type": "text/html; charset=utf-8" },
    },
  );
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
