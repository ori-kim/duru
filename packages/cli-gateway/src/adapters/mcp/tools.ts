import type { GatewayTool } from "../../types";

export function mcpHelpOperations(): readonly GatewayTool[] {
  return [
    { name: "tools", description: "List available MCP tools" },
    { name: "describe <tool>", description: "Describe an MCP tool" },
    { name: "types", description: "List available MCP types" },
    { name: "raw <method>", description: "Call a raw MCP JSON-RPC method" },
  ];
}

export function mcpToolsFromResponse(value: unknown): readonly GatewayTool[] | undefined {
  if (!isRecord(value) || !isRecord(value.body) || !isRecord(value.body.result)) return undefined;
  const tools = value.body.result.tools;
  if (!Array.isArray(tools)) return [];

  return tools.flatMap((tool) => {
    if (!isRecord(tool) || typeof tool.name !== "string" || tool.name.length === 0) return [];
    return [
      {
        name: tool.name,
        ...(typeof tool.description === "string" ? { description: tool.description } : {}),
        ...(tool.inputSchema !== undefined ? { inputSchema: tool.inputSchema } : {}),
      },
    ];
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
