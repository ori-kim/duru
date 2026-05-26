import { describe, expect, test } from "bun:test";
import { apiAdapter } from "./adapters/api";
import { applyTargetEnv } from "./env-interpolation";
import { createMemoryGatewayStore } from "./memory-store";

describe("gateway middleware env interpolation", () => {
  test("applyTargetEnv interpolates target headers via services.env", async () => {
    const store = createMemoryGatewayStore({
      targets: [
        {
          name: "slack",
          type: "api",
          config: {
            baseUrl: "https://example.com",
            headers: { Authorization: "Bearer ${TOKEN}" },
          },
        },
      ],
    });
    const target = await store.getTarget("slack");
    if (!target) throw new Error("missing target fixture");
    const adapter = apiAdapter();
    const config = adapter.schema.parse(target.config);
    const interpolated = await applyTargetEnv(config, {
      manifest: { name: "slack", type: "api" },
      options: {
        services: {
          env: {
            async loadTargetEnv() {
              return new Map([["TOKEN", "shhh"]]);
            },
          },
        },
      },
    });

    expect(interpolated).toEqual({
      baseUrl: "https://example.com",
      headers: { Authorization: "Bearer shhh" },
    });
  });
});
