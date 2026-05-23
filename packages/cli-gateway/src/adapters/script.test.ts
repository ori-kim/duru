import { describe, expect, test } from "bun:test";
import { createMemoryGatewayStore } from "../memory-store";
import { scriptAdapter } from "./script";

describe("@clip/cli-gateway script adapter", () => {
  test("maps JSON object input onto configured command args", async () => {
    const adapter = scriptAdapter();
    const config = adapter.schema.parse({
      commands: {
        greet: {
          description: "Greet by name and tag",
          script: 'printf \'hello %s %s\\n\' "$1" "$2"',
          args: ["name", "tag"],
        },
      },
    });
    const target = adapter.createTarget({
      manifest: { name: "local-scripts", type: "script", config },
      config,
      context: { store: createMemoryGatewayStore() },
    });

    const result = await target.invoke({
      argv: ["greet", '{"name":"example","tag":"test-service"}'],
    });

    expect(result).toEqual({ ok: true, value: "hello example test-service", exitCode: 0 });
  });
});
