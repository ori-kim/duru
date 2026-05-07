import { buildAliasSection } from "@clip/core";
import type { HasAliases, TargetResult, Tool } from "@clip/core";

export const MCP_INTROSPECTION_SUBCOMMANDS = new Set(["tools", "refresh", "describe", "schema"]);

export function isMcpIntrospectionSubcommand(subcommand: string): boolean {
  return MCP_INTROSPECTION_SUBCOMMANDS.has(subcommand);
}

function shortDescription(description: string | undefined, maxLength: number): string {
  const firstLine = (description ?? "").split("\n")[0] ?? "";
  return firstLine.length > maxLength ? `${firstLine.slice(0, maxLength - 3)}...` : firstLine;
}

function findToolArg(args: string[]): string | undefined {
  return args.find((arg) => !arg.startsWith("-"));
}

function toolNotFound(toolName: string, targetName: string): TargetResult {
  return {
    exitCode: 1,
    stdout: "",
    stderr: `Tool "${toolName}" not found. Run: clip ${targetName} tools\n`,
  };
}

export function formatMcpTools(tools: Tool[], target: HasAliases, jsonMode: boolean, nameWidth = 24): TargetResult {
  if (jsonMode) {
    return { exitCode: 0, stdout: `${JSON.stringify({ tools }, null, 2)}\n`, stderr: "" };
  }

  const scripts = buildAliasSection(target);
  if (tools.length === 0) {
    return { exitCode: 0, stdout: `No tools available.${scripts}\n`, stderr: "" };
  }

  const lines = tools.map((tool) => `  ${tool.name.padEnd(nameWidth)} ${shortDescription(tool.description, 60)}`);
  return { exitCode: 0, stdout: `Tools:\n${lines.join("\n")}\n${scripts}`, stderr: "" };
}

export function formatMcpDescribe(tools: Tool[], args: string[], targetName: string, jsonMode: boolean): TargetResult {
  const toolName = findToolArg(args);
  if (!toolName) {
    return { exitCode: 1, stdout: "", stderr: `Usage: clip ${targetName} describe <tool>\n` };
  }

  const tool = tools.find((t) => t.name === toolName);
  if (!tool) return toolNotFound(toolName, targetName);

  if (jsonMode) {
    return { exitCode: 0, stdout: `${JSON.stringify(tool, null, 2)}\n`, stderr: "" };
  }

  const lines = [
    `Name: ${tool.name}`,
    "",
    "Description:",
    tool.description || "(none)",
    "",
    "Input Schema:",
    JSON.stringify(tool.inputSchema ?? {}, null, 2),
  ];
  return { exitCode: 0, stdout: `${lines.join("\n")}\n`, stderr: "" };
}

export function formatMcpSchema(tools: Tool[], args: string[], targetName: string): TargetResult {
  const toolName = findToolArg(args);
  if (!toolName) {
    return { exitCode: 1, stdout: "", stderr: `Usage: clip ${targetName} schema <tool>\n` };
  }

  const tool = tools.find((t) => t.name === toolName);
  if (!tool) return toolNotFound(toolName, targetName);

  return { exitCode: 0, stdout: `${JSON.stringify(tool.inputSchema ?? {}, null, 2)}\n`, stderr: "" };
}

export function maybeFormatMcpIntrospection(
  subcommand: string,
  args: string[],
  tools: Tool[],
  target: HasAliases,
  targetName: string,
  jsonMode: boolean,
  nameWidth?: number,
): TargetResult | null {
  if (subcommand === "refresh") {
    return { exitCode: 0, stdout: `Refreshed "${targetName}" schema (${tools.length} tools)\n`, stderr: "" };
  }
  if (subcommand === "tools") return formatMcpTools(tools, target, jsonMode, nameWidth);
  if (subcommand === "describe") return formatMcpDescribe(tools, args, targetName, jsonMode);
  if (subcommand === "schema") return formatMcpSchema(tools, args, targetName);
  return null;
}
