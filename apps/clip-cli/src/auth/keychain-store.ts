import { spawn } from "node:child_process";
import type { OAuthSubject, OAuthToken, OAuthTokenStore } from "@clip/auth";
import { oauthSubjectKey } from "@clip/auth";

export type SecurityCommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type CreateMacOSKeychainOAuthTokenStoreOptions = {
  service?: string;
  runSecurity?: (args: readonly string[]) => Promise<SecurityCommandResult>;
};

export function createMacOSKeychainOAuthTokenStore(
  options: CreateMacOSKeychainOAuthTokenStoreOptions = {},
): OAuthTokenStore {
  const service = options.service ?? "clip.oauth";
  const runSecurity = options.runSecurity ?? runSecurityCommand;

  return {
    async get(subject) {
      const result = await runSecurity(["find-generic-password", "-s", service, "-a", account(subject), "-w"]);
      if (result.exitCode !== 0) {
        if (isMissingKeychainEntry(result)) return undefined;
        throw new Error(result.stderr || `security find-generic-password failed with exit code ${result.exitCode}`);
      }

      return parseToken(result.stdout);
    },
    async set(subject, token) {
      const result = await runSecurity([
        "add-generic-password",
        "-U",
        "-s",
        service,
        "-a",
        account(subject),
        "-w",
        JSON.stringify(token),
      ]);
      if (result.exitCode !== 0) {
        throw new Error(result.stderr || `security add-generic-password failed with exit code ${result.exitCode}`);
      }
    },
    async delete(subject) {
      const result = await runSecurity(["delete-generic-password", "-s", service, "-a", account(subject)]);
      if (result.exitCode !== 0 && !isMissingKeychainEntry(result)) {
        throw new Error(result.stderr || `security delete-generic-password failed with exit code ${result.exitCode}`);
      }
    },
  };
}

function account(subject: OAuthSubject): string {
  return oauthSubjectKey(subject);
}

function parseToken(stdout: string): OAuthToken {
  const parsed = JSON.parse(stdout.trim()) as unknown;
  if (!isRecord(parsed) || typeof parsed.accessToken !== "string" || parsed.tokenType !== "Bearer") {
    throw new Error("Invalid OAuth token stored in keychain");
  }

  return {
    accessToken: parsed.accessToken,
    tokenType: "Bearer",
    ...(typeof parsed.refreshToken === "string" ? { refreshToken: parsed.refreshToken } : {}),
    ...(typeof parsed.expiresAt === "number" ? { expiresAt: parsed.expiresAt } : {}),
    ...(typeof parsed.scope === "string" ? { scope: parsed.scope } : {}),
  };
}

function isMissingKeychainEntry(result: SecurityCommandResult): boolean {
  return result.exitCode !== 0 && /could not be found|not found/i.test(result.stderr);
}

function runSecurityCommand(args: readonly string[]): Promise<SecurityCommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("security", [...args], { stdio: ["ignore", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    child.on("error", reject);
    child.on("close", (exitCode) => {
      resolve({
        exitCode: exitCode ?? 1,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
