import { removeTokens } from "../commands/oauth.ts";
import { findTargetConfigDir, getTarget, loadConfig } from "../config.ts";
import type { Registry } from "../extension.ts";
import { die } from "../utils/errors.ts";
import { join } from "path";
import { CONFIG_DIR } from "../config.ts";

export async function runLogin(args: string[], registry?: Registry): Promise<void> {
  const name = args[0];
  if (!name) die("Usage: clip login <target>");
  const cfg = await loadConfig();
  const { type, target } = getTarget(cfg, name);

  // contribution의 loginHandler가 있으면 위임
  const contribution = registry?.getContribution(type);
  if (contribution?.loginHandler) {
    await contribution.loginHandler(name, target);
    return;
  }

  // fallback: grpc 타입은 OAuth 미지원 안내
  if (type === "grpc") {
    const authDir = findTargetConfigDir(name, "grpc") ?? join(CONFIG_DIR, "target", "grpc", name);
    die(
      `"${name}" is a gRPC target. gRPC v1 doesn't support automatic OAuth.\nStore static bearer token in ${authDir}/auth.json\nor use 'metadata: {authorization: "Bearer <token>"}' in config.yml.`,
    );
  }

  die(`"${name}" (type: ${type}) does not support OAuth login.`);
}

export async function runLogout(args: string[]): Promise<void> {
  const name = args[0];
  if (!name) die("Usage: clip logout <target>");
  const cfg = await loadConfig();
  const { type } = getTarget(cfg, name);
  if (type === "api") {
    await removeTokens(name, "api");
  } else if (type === "grpc") {
    await removeTokens(name, "grpc");
  } else if (type === "graphql") {
    await removeTokens(name, "graphql");
  } else {
    await removeTokens(name);
  }
  console.log(`Logged out of "${name}".`);
}
