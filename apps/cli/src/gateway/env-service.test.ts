import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDuruFileHome } from "@duru/file-store";
import { createAppGatewayEnvService } from "./env-service.ts";

async function freshHome(): Promise<string> {
  return mkdtemp(join(tmpdir(), "duru-env-service-"));
}

describe("createAppGatewayEnvService", () => {
  test("returns empty map when no env files exist", async () => {
    const home = await freshHome();
    const service = createAppGatewayEnvService({ fileHome: createDuruFileHome({ home }) });
    const env = await service.loadTargetEnv({ target: "slack", type: "mcp" });
    expect(env.size).toBe(0);
  });

  test("loads global ~/.duru/.env", async () => {
    const home = await freshHome();
    await writeFile(join(home, ".env"), "GLOBAL_KEY=global_value\n");
    const service = createAppGatewayEnvService({ fileHome: createDuruFileHome({ home }) });
    const env = await service.loadTargetEnv({ target: "slack", type: "mcp" });
    expect(env.get("GLOBAL_KEY")).toBe("global_value");
  });

  test("target-scoped env overrides global", async () => {
    const home = await freshHome();
    await writeFile(join(home, ".env"), "TOKEN=global\nOTHER=ok\n");
    await mkdir(join(home, "gateway", "mcp", "slack"), { recursive: true });
    await writeFile(join(home, "gateway", "mcp", "slack", ".env"), "TOKEN=target\n");
    const service = createAppGatewayEnvService({ fileHome: createDuruFileHome({ home }) });
    const env = await service.loadTargetEnv({ target: "slack", type: "mcp" });
    expect(env.get("TOKEN")).toBe("target");
    expect(env.get("OTHER")).toBe("ok");
  });

  test("does not leak env across calls (no process.env mutation)", async () => {
    const home = await freshHome();
    await writeFile(join(home, ".env"), "LEAKED=should_not_appear\n");
    const before = process.env.LEAKED;
    const service = createAppGatewayEnvService({ fileHome: createDuruFileHome({ home }) });
    await service.loadTargetEnv({ target: "slack", type: "mcp" });
    expect(process.env.LEAKED).toBe(before);
  });

  test("rejects target/type names that escape the gateway directory", async () => {
    const home = await freshHome();
    const service = createAppGatewayEnvService({ fileHome: createDuruFileHome({ home }) });
    const env = await service.loadTargetEnv({ target: "../escape", type: "mcp" });
    expect(env.size).toBe(0);
  });
});
