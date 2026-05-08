import { describe, expect, spyOn, test } from "bun:test";
import { buildGraphqlCurlCommand, executeGraphql } from "./executor.ts";

describe("GraphQL dry run", () => {
  test("raw query prints curl without fetching schema or executing", async () => {
    const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(() => {
      throw new Error("fetch should not be called during dry-run");
    });

    try {
      const result = await executeGraphql(
        {
          endpoint: "https://api.example.com/graphql",
          headers: { Authorization: "Bearer dummy-token" },
          oauth: false,
        },
        {
          targetName: "gql-test",
          subcommand: "query",
          args: ["query { viewer { id } }", "--variables", '{"limit":1}'],
          headers: { "X-Trace": "1" },
          dryRun: true,
          jsonMode: false,
          passthrough: false,
        },
      );

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("curl -X POST 'https://api.example.com/graphql'");
      expect(result.stdout).toContain("-H 'Authorization: Bearer dummy-token'");
      expect(result.stdout).toContain("-H 'X-Trace: 1'");
      expect(result.stdout).toContain('"query":"query { viewer { id } }"');
      expect(result.stdout).toContain('"variables":{"limit":1}');
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  test("curl preview shell-quotes headers and JSON body", () => {
    const out = buildGraphqlCurlCommand(
      "https://api.example.com/graphql",
      { "X-Name": "team's token" },
      { query: "query { viewer { login } }", variables: { q: "a'b" } },
    );

    expect(out).toContain("-H 'X-Name: team'\\''s token'");
    expect(out).toContain('-d \'{"query":"query { viewer { login } }","variables":{"q":"a\'\\\'\'b"}}\'');
  });
});
