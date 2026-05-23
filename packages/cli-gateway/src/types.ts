import type { CliPlugin } from "@clip/kit";

export type CliGatewayOptions = {
  store: GatewayStore;
  adapters?: readonly GatewayAdapter[];
  env?: Readonly<Record<string, string | undefined>>;
  services?: GatewayServices;
  output?: GatewayOutputOptions;
};

export type GatewayOutputOptions = {
  renderer?: string;
};

export type GatewayContext = {
  store: GatewayStore;
  env?: Readonly<Record<string, string | undefined>>;
  services?: GatewayServices;
  output?: GatewayOutputOptions;
};

export type GatewayServices = Record<string, unknown>;

export type GatewayStore = {
  listTargets(): Promise<readonly GatewayTargetRecord[]>;
  getTarget(name: string): Promise<GatewayTargetRecord | undefined>;
  saveTarget(record: GatewayTargetRecord): Promise<void>;
  removeTarget(name: string): Promise<void>;
  listProfiles(target: string): Promise<readonly GatewayProfileRecord[]>;
  getProfile(target: string, name: string): Promise<GatewayProfileRecord | undefined>;
  saveProfile(target: string, profile: GatewayProfileRecord): Promise<void>;
  removeProfile(target: string, name: string): Promise<void>;
  listAliases(target: string): Promise<readonly GatewayAliasRecord[]>;
  saveAlias(target: string, alias: GatewayAliasRecord): Promise<void>;
  removeAlias(target: string, name: string): Promise<void>;
};

export type GatewayStoreSeed = {
  targets?: readonly GatewayTargetRecord[];
  profiles?: readonly GatewayProfileRecord[];
  aliases?: readonly GatewayAliasRecord[];
};

export type GatewayRecordSource = {
  path?: string;
  format?: string;
};

export type GatewayTargetRecord<TConfig = unknown> = {
  name: string;
  type: string;
  config: TConfig;
  allow?: readonly string[];
  deny?: readonly string[];
  acl?: AclTree;
  timeoutMs?: number;
  source?: GatewayRecordSource;
};

export type GatewayProfileRecord<TConfig = unknown> = {
  target: string;
  name: string;
  config?: TConfig;
  source?: GatewayRecordSource;
};

export type GatewayAliasRecord = {
  target: string;
  name: string;
  operation: string;
  args?: readonly string[];
  source?: GatewayRecordSource;
};

export type AclTree = Record<string, unknown>;

export type GatewayAdapter<TConfig = unknown> = {
  type: string;
  schema: GatewaySchema<TConfig>;
  detect?(input: AddInput): boolean | Promise<boolean>;
  add?(input: AddInput): Promise<TConfig>;
  normalize?(config: TConfig, ctx: NormalizeContext): TConfig | Promise<TConfig>;
  createTarget(input: GatewayTargetCreateInput<TConfig>): GatewayTarget<TConfig>;
};

export type GatewaySchema<TConfig = unknown> = {
  parse(value: unknown): TConfig;
};

export type GatewayTargetCreateInput<TConfig = unknown> = {
  manifest: GatewayTargetRecord;
  config: TConfig;
  profile?: GatewayProfileRecord;
  context: GatewayContext;
};

export type GatewayTarget<TConfig = unknown> = {
  name: string;
  type: string;
  config: TConfig;
  profile?: string;
  invoke(ctx: GatewayInvokeContext): Promise<GatewayResult>;
  catalog?(ctx: GatewayCatalogContext): Promise<readonly GatewayTool[] | null>;
  refresh?(ctx: GatewayRefreshContext): Promise<GatewayTargetRefreshResult<TConfig> | undefined>;
  auth?: GatewayTargetAuth;
  listRow?(): GatewayListRow | Promise<GatewayListRow>;
  complete?(ctx: GatewayCompletionContext): Promise<readonly CompletionItem[]>;
};

export type GatewayInspectReport = {
  ok: boolean;
  target: GatewayTargetInspection;
  diagnostics: readonly GatewayDiagnostic[];
};

export type GatewayTargetInspection = {
  name: string;
  type: string;
  profile?: string;
  config: { redacted: true };
  registered: boolean;
  summary?: string;
  capabilities: GatewayTargetCapabilities;
  operations: readonly GatewayTool[];
};

export type GatewayTargetCapabilities = {
  invoke: boolean;
  catalog: boolean;
  refresh: boolean;
  auth?: {
    status: boolean;
    login: boolean;
    logout: boolean;
  };
  complete: boolean;
};

export type GatewayDiagnostic = {
  severity: "error" | "warning" | "info";
  code: string;
  message: string;
  path?: readonly string[];
};

export type GatewayTargetAuth = {
  status?(ctx: GatewayAuthContext): Promise<GatewayAuthState>;
  login?(ctx: GatewayAuthContext): Promise<GatewayAuthState> | Promise<void>;
  logout?(ctx: GatewayAuthContext): Promise<GatewayAuthState> | Promise<void>;
};

export type GatewayAuthState = {
  authenticated: boolean;
  label?: string;
};

export type GatewayTargetRefreshResult<TConfig = unknown> = {
  config?: TConfig;
};

export type GatewayResult =
  | {
      ok: true;
      value?: unknown;
      exitCode?: number;
    }
  | {
      ok: false;
      error: unknown;
      exitCode?: number;
    };

export type GatewayTool = {
  name: string;
  description?: string;
  inputSchema?: unknown;
};

export type GatewayListRow = {
  name: string;
  type: string;
  summary?: string;
};

export type CompletionItem = {
  value: string;
  description?: string;
};

export type AddInput = {
  name: string;
  type?: string;
  argv: readonly string[];
};

export type NormalizeContext = {
  target: string;
};

export type GatewayInvokeContext = {
  argv: readonly string[];
  signal?: AbortSignal;
  dryRun?: boolean;
};

export type GatewayCatalogContext = {
  target: string;
  signal?: AbortSignal;
};

export type GatewayRefreshContext = {
  target: string;
  signal?: AbortSignal;
};

export type GatewayAuthContext = {
  target: string;
  profile?: string;
  provider?: string;
  signal?: AbortSignal;
};

export type ListContext = {
  target: string;
};

export type GatewayCompletionContext = {
  argv: readonly string[];
  target?: string;
  profile?: string;
};

export type AuthContext = GatewayAuthContext;
export type DescribeContext = GatewayCatalogContext;
export type ExecuteContext = GatewayInvokeContext;
export type RefreshContext = GatewayRefreshContext;

export type CliGatewayPlugin = CliPlugin;
