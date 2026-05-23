import { createGatewayTargetAuth } from "../../auth";
import type { GatewayTargetHelpDocument } from "../../help";
import type { GatewayAdapter, GatewayContext, GatewayInvokeContext, GatewayResult, GatewayTool } from "../../types";
import { apiConfigFromAddInput, detectApiInput, parseApiConfig } from "./config";
import type { ApiAdapterConfig } from "./config";
import { executeRawApiTarget, fetchSpec, isRawRequestStart } from "./http";
import { executeOpenApiOperation, loadParsedSpec } from "./openapi-runtime";

export type { ApiAdapterConfig } from "./config";

export function apiAdapter(): GatewayAdapter<ApiAdapterConfig> {
  return {
    type: "api",
    schema: { parse: parseApiConfig },
    detect(input) {
      return detectApiInput(input);
    },
    async add(input) {
      return apiConfigFromAddInput(input);
    },
    createTarget({ manifest, config, context, profile }) {
      return {
        name: manifest.name,
        type: manifest.type,
        config,
        profile: profile?.name,
        async invoke(ctx) {
          return executeApiTarget(config, ctx, context, manifest.name, profile?.name);
        },
        async catalog(ctx) {
          const spec = await loadParsedSpec(config, context, ctx.signal);
          return spec?.tools ?? [];
        },
        async refresh(ctx) {
          if (!config.openapiUrl) return undefined;
          const spec = await fetchSpec(config, context, ctx.signal);
          return { config: { ...config, spec } };
        },
        listRow() {
          return { name: manifest.name, type: "api", summary: config.baseUrl ?? config.openapiUrl };
        },
        auth: createGatewayTargetAuth({ manifest, auth: config.auth, context }),
        async check() {
          return { diagnostics: [] };
        },
      };
    },
  };
}

async function executeApiTarget(
  config: ApiAdapterConfig,
  ctx: GatewayInvokeContext,
  gatewayContext: GatewayContext,
  target: string,
  profile: string | undefined,
): Promise<GatewayResult> {
  try {
    return await executeApiTargetUnsafe(config, ctx, gatewayContext, target, profile);
  } catch (error) {
    return { ok: false, error: { message: errorMessage(error) }, exitCode: 1 };
  }
}

async function executeApiTargetUnsafe(
  config: ApiAdapterConfig,
  ctx: GatewayInvokeContext,
  gatewayContext: GatewayContext,
  target: string,
  profile: string | undefined,
): Promise<GatewayResult> {
  const firstArg = ctx.argv[0];

  if (firstArg === "--help" || firstArg === "-h") {
    return executeApiHelp(config, ctx, gatewayContext, target);
  }

  if (firstArg === "tools") {
    const spec = await loadParsedSpec(config, gatewayContext, ctx.signal);
    return { ok: true, value: spec?.tools ?? [], exitCode: 0 };
  }

  if (firstArg === "describe") {
    const operation = ctx.argv[1];
    if (!operation) return { ok: false, error: { message: "describe requires an operation name" }, exitCode: 2 };

    const spec = await loadParsedSpec(config, gatewayContext, ctx.signal);
    const tool = spec?.tools.find((item) => item.name === operation);
    if (!tool) return { ok: false, error: { message: `Unknown API operation: "${operation}"` }, exitCode: 2 };

    return { ok: true, value: tool, exitCode: 0 };
  }

  if (firstArg === "types") {
    return { ok: true, value: [], exitCode: 0 };
  }

  if (firstArg && !isRawRequestStart(firstArg)) {
    const spec = await loadParsedSpec(config, gatewayContext, ctx.signal);
    const tool = spec?.tools.find((item) => item.name === firstArg);
    if (tool && spec) return executeOpenApiOperation(config, spec, tool, ctx, gatewayContext, target, profile);
    if (spec) return { ok: false, error: { message: `Unknown API operation: "${firstArg}"` }, exitCode: 2 };
  }

  return executeRawApiTarget(config, ctx, gatewayContext, target, profile);
}

async function executeApiHelp(
  config: ApiAdapterConfig,
  ctx: GatewayInvokeContext,
  gatewayContext: GatewayContext,
  target: string,
): Promise<GatewayResult> {
  const spec = await loadParsedSpec(config, gatewayContext, ctx.signal);
  const value: GatewayTargetHelpDocument = {
    target,
    type: "api",
    usage: `${target} <operation|path>`,
    operations: [...apiHelpOperations(), ...(spec?.tools ?? [])],
  };
  return { ok: true, value, exitCode: 0 };
}

function apiHelpOperations(): readonly GatewayTool[] {
  return [
    { name: "tools", description: "List available API operations" },
    { name: "describe <operation>", description: "Describe an API operation" },
    { name: "types", description: "List available API types" },
  ];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
