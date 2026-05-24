import { describe, expect, test } from "bun:test";
import { createCli } from "@duru/cli-kit";
import { cliGateway, createGatewayCli } from "./index";
import { createMemoryGatewayStore } from "./memory-store";
import type { CliGatewayOptions, GatewayAdapter } from "./types";

describe("@duru/cli-gateway runtime ACL", () => {
  test("enforces wildcard allow and deny rules", async () => {
    const store = createMemoryGatewayStore({
      targets: [
        {
          name: "test-service",
          type: "cli",
          config: { command: "test-service" },
          allow: ["list*", "view"],
          deny: ["listSecrets"],
        },
      ],
    });
    const cli = createGatewayTestCli({ store, adapters: [recordingAdapter()] });

    const allowed = await cli.run(["test-service", "listCats"], { render: false });
    const denied = await cli.run(["test-service", "listSecrets"], { render: false });
    const notAllowed = await cli.run(["test-service", "deleteCats"], { render: false });

    expect(allowed.result).toEqual({ command: "test-service", argv: ["listCats"] });
    expect(denied.result).toEqual({ message: 'Gateway target "test-service" denied operation: "listSecrets"' });
    expect(notAllowed.result).toEqual({
      message: 'Gateway target "test-service" does not allow operation: "deleteCats"',
    });
  });

  test("enforces ACL tree rules against the second command token", async () => {
    const store = createMemoryGatewayStore({
      targets: [
        {
          name: "test-service",
          type: "cli",
          config: { command: "test-service" },
          acl: {
            issue: { allow: ["list", "view"], deny: ["delete*"] },
          },
        },
      ],
    });
    const cli = createGatewayTestCli({ store, adapters: [recordingAdapter()] });

    const allowed = await cli.run(["test-service", "issue", "list"], { render: false });
    const denied = await cli.run(["test-service", "issue", "delete-all"], { render: false });
    const notAllowed = await cli.run(["test-service", "issue", "close"], { render: false });

    expect(allowed.result).toEqual({ command: "test-service", argv: ["issue", "list"] });
    expect(denied.result).toEqual({
      message: 'Gateway target "test-service" denied operation: "issue delete-all"',
    });
    expect(notAllowed.result).toEqual({
      message: 'Gateway target "test-service" does not allow operation: "issue close". Allowed: list, view',
    });
  });
});

function createGatewayTestCli(options: CliGatewayOptions) {
  return createCli({ name: "duru" })
    .use(cliGateway(options))
    .subCommand("gateway", createGatewayCli(options, { group: "Gateway" }));
}

function recordingAdapter(): GatewayAdapter<{ command: string }> {
  return {
    type: "cli",
    schema: {
      parse(value: unknown) {
        return value as { command: string };
      },
    },
    createTarget({ manifest, config }) {
      return {
        name: manifest.name,
        type: manifest.type,
        config,
        async invoke(ctx) {
          return { ok: true, value: { command: config.command, argv: ctx.argv } };
        },
      };
    },
  };
}
