import { describe, expect, test } from "bun:test";
import { formatToolHelp, parseToolArgs } from "@clip/core";
import { buildApiRequest, buildCurlCommand, buildInjectedHeaderArgs } from "./executor.ts";
import type { ApiTool } from "./openapi.ts";
import type { ApiTarget } from "./schema.ts";

const requiredCustomHeaderTool: ApiTool = {
  name: "list-cats",
  description: "List cats",
  method: "GET",
  path: "/v1/cats",
  pathParams: [],
  queryParams: [],
  headerParams: ["X-Custom-Header"],
  inputSchema: {
    type: "object",
    properties: {
      "X-Custom-Header": { type: "string" },
    },
    required: ["X-Custom-Header"],
  },
};

const catserviceTarget: ApiTarget = {
  baseUrl: "https://catservice.example.com",
  headers: {
    "X-Custom-Header": "custom-from-config",
  },
  auth: false,
};

describe("API executor injected header args", () => {
  test("uses configured headers as default tool args", () => {
    const schema = {
      required: ["X-Custom-Header"],
      properties: {
        "X-Custom-Header": { type: "string" },
      },
    };
    const injected = buildInjectedHeaderArgs(["X-Custom-Header"], {
      "X-Custom-Header": "custom",
    });

    expect(parseToolArgs([], schema, injected)).toEqual({ "X-Custom-Header": "custom" });
  });

  test("only exposes headers that are declared as OpenAPI header params", () => {
    expect(
      buildInjectedHeaderArgs(["X-Custom-Header"], {
        "X-Custom-Header": "custom",
        Authorization: "Bearer dummy-token",
      }),
    ).toEqual({ "X-Custom-Header": "custom" });
  });

  test("matches configured headers case-insensitively", () => {
    expect(
      buildInjectedHeaderArgs(["X-Custom-Header"], {
        "x-custom-header": "custom",
      }),
    ).toEqual({ "X-Custom-Header": "custom" });
  });

  test("builds a dry-run request when a required header is already injected", () => {
    const request = buildApiRequest(catserviceTarget, requiredCustomHeaderTool, undefined, []);

    expect(request.url).toBe("https://catservice.example.com/v1/cats");
    expect(request.headers["X-Custom-Header"]).toBe("custom-from-config");
    expect(request.injectedArgs).toEqual({ "X-Custom-Header": "custom-from-config" });
    expect(request.body).toBeUndefined();

    expect(buildCurlCommand(request.method, request.url, request.headers, request.body)).toContain(
      "-H 'X-Custom-Header: custom-from-config'",
    );
  });

  test("explicit CLI args override injected header defaults", () => {
    const request = buildApiRequest(catserviceTarget, requiredCustomHeaderTool, undefined, [
      "--X-Custom-Header",
      "manual-custom",
    ]);

    expect(request.headers["X-Custom-Header"]).toBe("manual-custom");
  });

  test("beforeExecute/global headers override target headers before injection", () => {
    const request = buildApiRequest(catserviceTarget, requiredCustomHeaderTool, undefined, [], {
      "X-Custom-Header": "hook-custom",
    });

    expect(request.injectedArgs).toEqual({ "X-Custom-Header": "hook-custom" });
    expect(request.headers["X-Custom-Header"]).toBe("hook-custom");
  });

  test("beforeExecute/global headers override target headers case-insensitively", () => {
    const request = buildApiRequest(catserviceTarget, requiredCustomHeaderTool, undefined, [], {
      "x-custom-header": "hook-custom",
    });

    expect(request.injectedArgs).toEqual({ "X-Custom-Header": "hook-custom" });
    expect(request.headers["X-Custom-Header"]).toBe("hook-custom");
    expect(request.headers["x-custom-header"]).toBeUndefined();
  });

  test("still rejects missing required headers when nothing injects them", () => {
    expect(() =>
      buildApiRequest(
        {
          baseUrl: "https://catservice.example.com",
          auth: false,
        },
        requiredCustomHeaderTool,
        undefined,
        [],
      ),
    ).toThrow("Missing required argument: args.X-Custom-Header");
  });

  test("does not leak injected headers into query strings or JSON bodies", () => {
    const tool: ApiTool = {
      ...requiredCustomHeaderTool,
      queryParams: ["query"],
      inputSchema: {
        type: "object",
        properties: {
          "X-Custom-Header": { type: "string" },
          query: { type: "string" },
        },
        required: ["X-Custom-Header", "query"],
      },
    };

    const request = buildApiRequest(catserviceTarget, tool, undefined, ["--query", "tag:test-service"]);

    expect(request.url).toBe("https://catservice.example.com/v1/cats?query=tag%3Atest-service");
    expect(request.headers["X-Custom-Header"]).toBe("custom-from-config");
    expect(request.body).toBeUndefined();
  });

  test("help marks injected required headers as injected, not manually required", () => {
    const injectedArgs = buildInjectedHeaderArgs(requiredCustomHeaderTool.headerParams, catserviceTarget.headers ?? {});
    const result = formatToolHelp({ ...requiredCustomHeaderTool, injectedArgs });

    expect(result.stdout).toContain("--X-Custom-Header");
    expect(result.stdout).toContain("[injected]");
    expect(result.stdout).not.toContain("--X-Custom-Header   string (required)");
  });
});
