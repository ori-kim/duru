import { describe, expect, test } from "bun:test";
import { formatMcpDescribe, formatMcpSchema, formatMcpTools } from "./introspection.ts";

const batchDesignTool = {
  name: "batch_design",
  description: "Apply batch design operations",
  inputSchema: {
    type: "object",
    properties: {
      filePath: { type: "string" },
      operations: { type: "string" },
    },
    required: ["filePath", "operations"],
  },
};

const tools = [batchDesignTool];

describe("MCP introspection output", () => {
  test("tools supports structured JSON output", () => {
    const result = formatMcpTools(tools, {}, true);
    expect(JSON.parse(result.stdout)).toEqual({ tools });
  });

  test("describe returns a specific tool with schema", () => {
    const result = formatMcpDescribe(tools, ["batch_design"], "pencil", false);
    expect(result.stdout).toContain("Name: batch_design");
    expect(result.stdout).toContain('"operations"');
  });

  test("schema returns raw inputSchema JSON", () => {
    const result = formatMcpSchema(tools, ["batch_design"], "pencil");
    expect(JSON.parse(result.stdout)).toEqual(batchDesignTool.inputSchema);
  });
});
