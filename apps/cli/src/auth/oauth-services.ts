import { spawn } from "node:child_process";
import { createOAuthRuntime } from "@duru/auth";
import type { OAuthRuntime, OAuthTokenStore } from "@duru/auth";
import type { GatewayOAuthService, GatewayOAuthServiceInput } from "@duru/cli-gateway";
import { waitForLocalOAuthCallback } from "./oauth-callback";

export type CreateAppOAuthGatewayServiceOptions = {
  tokens?: OAuthTokenStore;
  runtime?: OAuthRuntime;
  openUrl?: (url: string) => Promise<void> | void;
  defaultRedirectUri?: string;
};

export function createAppOAuthGatewayService(options: CreateAppOAuthGatewayServiceOptions = {}): GatewayOAuthService {
  const runtime =
    options.runtime ??
    createOAuthRuntime({
      tokens: requireTokenStore(options.tokens),
      openUrl: options.openUrl ?? openBrowserUrl,
      waitForCallback: waitForLocalOAuthCallback,
      defaultRedirectUri: options.defaultRedirectUri ?? "http://127.0.0.1:53682/oauth/callback",
    });

  return {
    status: (input) => runtime.status({ subject: input.subject, signal: input.signal }),
    login: (input) => runtime.login(runtimeInput(input)),
    logout: (input) => runtime.logout({ subject: input.subject, signal: input.signal }),
    accessToken: (input) => runtime.accessToken(runtimeInput(input)),
  };
}

function requireTokenStore(tokens: OAuthTokenStore | undefined): OAuthTokenStore {
  if (!tokens) throw new Error("App OAuth gateway service requires a token store");
  return tokens;
}

function runtimeInput(input: GatewayOAuthServiceInput) {
  return {
    subject: input.subject,
    provider: input.provider,
    ...(input.signal ? { signal: input.signal } : {}),
  };
}

function openBrowserUrl(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("open", [url], { stdio: "ignore" });
    child.on("error", reject);
    child.on("close", (exitCode) => {
      if (exitCode === 0) {
        resolve();
        return;
      }
      reject(new Error(`open failed with exit code ${exitCode ?? 1}`));
    });
  });
}
