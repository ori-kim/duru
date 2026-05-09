import { describe, expect, test } from "bun:test";
import { formatToolHelp, parseToolArgs } from "@clip/core";
import { buildApiRequest, buildCurlCommand, buildInjectedHeaderArgs, formatApiToolHelp } from "./executor.ts";
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

  test("subcommand-start/global headers override target headers before injection", () => {
    const request = buildApiRequest(catserviceTarget, requiredCustomHeaderTool, undefined, [], {
      "X-Custom-Header": "hook-custom",
    });

    expect(request.injectedArgs).toEqual({ "X-Custom-Header": "hook-custom" });
    expect(request.headers["X-Custom-Header"]).toBe("hook-custom");
  });

  test("subcommand-start/global headers override target headers case-insensitively", () => {
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

describe("API executor multipart/form-data", () => {
  const uploadTool: ApiTool = {
    name: "upload",
    description: "Upload files",
    method: "POST",
    path: "/upload",
    pathParams: [],
    queryParams: [],
    headerParams: [],
    bodyContentType: "multipart/form-data",
    multipartFields: {
      file: { file: true },
      files: { file: true, multiple: true },
    },
    inputSchema: {
      type: "object",
      properties: {
        file: { type: "string", format: "binary" },
        title: { type: "string" },
        files: {
          type: "array",
          items: { type: "string", format: "binary" },
        },
        metadata: { type: "object" },
      },
      required: ["file"],
    },
  };

  test("builds FormData for binary fields and lets fetch set the boundary content-type", () => {
    const request = buildApiRequest(
      { baseUrl: "https://api.example.com", auth: false, headers: { "content-type": "application/json" } },
      uploadTool,
      undefined,
      ["--file", "./a.pdf", "--title", "A"],
    );

    expect(request.body).toBeInstanceOf(FormData);
    expect(request.headers["content-type"]).toBeUndefined();
    expect(request.headers["Content-Type"]).toBeUndefined();
    expect(request.multipartParts).toEqual([
      { name: "file", value: "./a.pdf", filePath: "./a.pdf" },
      { name: "title", value: "A" },
    ]);
  });

  test("supports repeated binary array flags as multiple file parts", () => {
    const request = buildApiRequest({ baseUrl: "https://api.example.com", auth: false }, uploadTool, undefined, [
      "--file",
      "./cover.pdf",
      "--files",
      "./a.pdf",
      "--files",
      "./b.pdf",
    ]);

    expect(request.multipartParts).toEqual([
      { name: "file", value: "./cover.pdf", filePath: "./cover.pdf" },
      { name: "files", value: "./a.pdf", filePath: "./a.pdf" },
      { name: "files", value: "./b.pdf", filePath: "./b.pdf" },
    ]);
  });

  test("supports repeated --multipart-file escape hatch parts", () => {
    const request = buildApiRequest({ baseUrl: "https://api.example.com", auth: false }, uploadTool, undefined, [
      "--multipart-file",
      "file=./cover.pdf",
      "--multipart-file",
      "files=./a.pdf",
      "--multipart-file=files=./b.pdf",
      "--title",
      "Bundle",
    ]);

    expect(request.multipartParts).toEqual([
      { name: "file", value: "./cover.pdf", filePath: "./cover.pdf" },
      { name: "files", value: "./a.pdf", filePath: "./a.pdf" },
      { name: "files", value: "./b.pdf", filePath: "./b.pdf" },
      { name: "title", value: "Bundle" },
    ]);
  });

  test("serializes non-file objects as JSON string parts", () => {
    const request = buildApiRequest({ baseUrl: "https://api.example.com", auth: false }, uploadTool, undefined, [
      "--file",
      "./a.pdf",
      "--metadata",
      '{"source":"clip"}',
    ]);

    expect(request.multipartParts).toContainEqual({ name: "metadata", value: '{"source":"clip"}' });
  });

  test("dry-run renders multipart as curl -F parts", () => {
    const request = buildApiRequest({ baseUrl: "https://api.example.com", auth: false }, uploadTool, undefined, [
      "--file",
      "./a.pdf",
      "--title",
      "A",
    ]);

    expect(buildCurlCommand(request.method, request.url, request.headers, request.body, request.multipartParts)).toBe(
      "curl -X POST 'https://api.example.com/upload' \\\n  -F 'file=@./a.pdf' \\\n  -F 'title=A'\n",
    );
  });

  test("help documents multipart file fields and escape hatch", () => {
    const result = formatApiToolHelp(uploadTool);

    expect(result.stdout).toContain("content-type: multipart/form-data");
    expect(result.stdout).toContain("file fields: file, files");
    expect(result.stdout).toContain("--multipart-file <field>=<path>");
  });
});
