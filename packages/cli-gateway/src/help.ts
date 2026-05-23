import type { GatewayTool } from "./types";

export type GatewayTargetHelpDocument = {
  target: string;
  type: string;
  usage: string;
  operations: readonly GatewayTool[];
};

export function isGatewayTargetHelpDocument(value: unknown): value is GatewayTargetHelpDocument {
  return (
    isRecord(value) &&
    typeof value.target === "string" &&
    typeof value.type === "string" &&
    typeof value.usage === "string" &&
    Array.isArray(value.operations)
  );
}

export function formatGatewayTargetHelp(document: GatewayTargetHelpDocument): string {
  const lines = [`Usage: ${document.usage}`, "", `Target: ${document.target} (${document.type})`];
  if (document.operations.length === 0) return lines.join("\n");

  const nameWidth = Math.max(...document.operations.map((operation) => operation.name.length));
  lines.push("", "Operations:");
  for (const operation of document.operations) {
    const details = operation.description ? `  ${summaryLine(operation.description)}` : "";
    lines.push(`  ${operation.name.padEnd(nameWidth)}${details}`.trimEnd());
  }

  return lines.join("\n");
}

function summaryLine(value: string): string {
  return value.split(/\r?\n/)[0]?.trim() ?? "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
