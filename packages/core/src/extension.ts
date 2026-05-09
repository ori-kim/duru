export type TargetResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type Tool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  injectedArgs?: Record<string, unknown>;
};

export type ExecutorContext = {
  targetName: string;
  subcommand: string;
  args: string[];
  headers: Record<string, string>;
  dryRun: boolean;
  jsonMode: boolean;
  globalOptions?: Record<string, OptionValue>;
  passthrough: boolean;
};

export type Executor<T> = (target: T, ctx: ExecutorContext) => Promise<TargetResult>;

export type HookPhase = "command-start" | "command-end" | "subcommand-start" | "subcommand-end";

export type OptionValue = boolean | string | string[];

export type OptionSpec = {
  name: string;
  type: "boolean" | "value";
  aliases?: string[];
  description?: string;
  valueName?: string;
  default?: OptionValue;
  placement?: "leading" | "any";
};

export type CliCommandSummary =
  | { kind: "none"; argv: readonly string[] }
  | { kind: "help"; argv: readonly string[] }
  | { kind: "version"; argv: readonly string[] }
  | { kind: "command"; argv: readonly string[]; name: string; args: readonly string[] }
  | {
      kind: "target";
      argv: readonly string[];
      token: string;
      target: string;
      targetType?: string;
      profile?: string;
      subcommand?: string;
      args: readonly string[];
      dryRun: boolean;
      jsonMode: boolean;
      pipeMode: boolean;
      passthrough?: boolean;
      format?: string;
    };

export type CommandHookCtx = Readonly<{
  phase: "command-start" | "command-end";
  argv: readonly string[];
  startedAt: string;
  durationMs?: number;
  exitCode?: number;
  command?: CliCommandSummary;
  result?: TargetResult;
  error?: unknown;
}>;

export type SubcommandHookCtx = Readonly<{
  phase: "subcommand-start" | "subcommand-end";
  kind: "command" | "target";
  command: string;
  subcommand: string;
  subcommandIndex: number;
  args: readonly string[];
  globalOptions: Record<string, OptionValue>;
  targetName: string;
  targetType: string;
  target: Readonly<unknown>;
  headers: Record<string, string>;
  dryRun: boolean;
  jsonMode: boolean;
  passthrough: boolean;
  result?: TargetResult;
}>;

export type HookCtx = CommandHookCtx | SubcommandHookCtx;

export type HookReturn =
  | undefined
  | { headers?: Record<string, string>; args?: string[]; subcommand?: string }
  | { shortCircuit: TargetResult }
  | { result: Partial<TargetResult> };

export type HookCtxFor<P extends HookPhase> = Extract<HookCtx, { phase: P }>;
export type HookFn<P extends HookPhase = HookPhase> = (ctx: HookCtxFor<P>) => HookReturn | Promise<HookReturn>;

export type ErrorCtx = Omit<SubcommandHookCtx, "phase"> & {
  phase: "subcommand-error";
  error: unknown;
  aclDenied?: boolean;
};
export type ErrorReturn = undefined | { result: TargetResult } | { rethrow: unknown };
export type ErrorHandler = (ctx: ErrorCtx) => ErrorReturn | Promise<ErrorReturn>;

// 구조적 타이핑으로 zod 직접 의존 없이 schema 정의
export type ParseResult<T> = { success: true; data: T } | { success: false; error: { message: string } };

export type AnySchema<T = unknown> = {
  safeParse: (input: unknown) => ParseResult<T>;
};

export type NormalizeCtx = {
  /** configDir: target의 config.yml이 있는 디렉터리 절대 경로 */
  configDir: string;
  /** env: 이 target에 적용된 환경 변수 (global + target .env 병합 결과) */
  env: Record<string, string>;
};

export type TargetTypeDef<T = unknown> = {
  type: string;
  schema: AnySchema<T>;
  executor: (target: T, ctx: ExecutorContext) => Promise<TargetResult>;
  describeTools?: (target: T, ctx: { targetName: string; headers?: Record<string, string> }) => Promise<Tool[] | null>;
  /**
   * normalizeConfig: schema 검증 이후, Config에 저장하기 직전에 호출.
   * env 치환·경로 해석 등 builtin별 후처리를 여기에 구현한다.
   * 반환값이 없으면 schema 검증 결과를 그대로 사용한다.
   */
  normalizeConfig?: (parsed: T, ctx: NormalizeCtx) => T;
  /**
   * aclRule.skipSubcommands: ACL 검사를 건너뛸 subcommand 목록.
   * dispatch에서 shouldCheckAcl 판단에 사용된다.
   */
  aclRule?: { skipSubcommands?: string[] };
};

// --- TargetTypeContribution ---

export type ArgSpec = {
  booleanFlags?: string[];
  valueFlags?: string[];
  identifyFlags?: string[];
  passthrough?: boolean;
};

export type DisplayHint = {
  headerColor?: string;
  nameColor?: string;
};

export type TargetTypeManifestSpec = {
  name: string;
  argSpec?: ArgSpec;
  displayHint?: DisplayHint;
  dispatchPriority?: number;
};

export type ListOpts = {
  bound: Set<string>;
  tty: boolean;
  color: (code: string, text: string) => string;
  bind: (name: string) => string;
};

export type ListRow = {
  name: string;
  nameColor?: string;
  subject?: string;
  profile?: string;
  detail?: string;
  status?: string;
  markers?: string[];
};

export type AddArgs = {
  name: string;
  positionals: string[];
  flags: Record<string, string>;
  allow: string[] | undefined;
  deny: string[] | undefined;
};

/**
 * TargetTypeContribution: CLI-layer の コントリビューション インターフェース.
 * 각 builtin이 CLI 명령별 렌더/핸들러를 등록한다.
 */
export type TargetTypeContribution = {
  type: string;
  dispatchPriority?: number;
  argSpec?: ArgSpec;
  displayHint?: DisplayHint;
  /** clip list — structured target row for aligned rendering */
  listRowRenderer?: (name: string, target: unknown, opts: ListOpts) => Promise<ListRow>;
  /** clip list — legacy target line renderer */
  listRenderer?: (name: string, target: unknown, opts: ListOpts) => Promise<string>;
  /** clip add — URL이 이 타입에 해당하는지 판단 */
  urlHeuristic?: (url: string) => boolean;
  /** clip add — 이 타입의 target 추가 처리 */
  addHandler?: (args: AddArgs) => Promise<void>;
  /** clip help — target 상세 설명 한 줄 */
  helpRenderer?: (name: string, target: unknown) => Promise<string>;
  /** clip login — OAuth / auth 처리 */
  loginHandler?: (name: string, target: unknown) => Promise<void>;
  /** clip completion — zsh completion 조각 생성 */
  completionContributor?: () => string;
};

// --- Commands ---

export type CommandCtx = {
  args: string[];
  options: Record<string, OptionValue>;
  globalOptions: Record<string, OptionValue>;
  argv: readonly string[];
  logger: Logger;
  signal: AbortSignal;
};

export type CommandHandler = (ctx: CommandCtx) => Promise<void>;

export type CommandSpec = {
  name: string;
  summary?: string;
  description?: string;
  options?: OptionSpec[];
  early?: boolean;
  protected?: boolean;
  completion?: () => string;
  run: CommandHandler;
};

export type CommandRegistration = CommandSpec;
export type CommandOverride = Omit<CommandSpec, "name">;

export type CommandRegistryApi = {
  register(spec: CommandRegistration): void;
  override(name: string, spec: CommandOverride): void;
};

export type OptionRegistryApi = {
  registerGlobal(spec: OptionSpec): void;
};

export type HookOpts = {
  priority?: number;
  match?: {
    type?: string[];
    target?: (string | RegExp)[];
    subcommand?: string[];
  };
};

export type Logger = {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
  debug: (msg: string) => void;
};

import type { OutputRenderer, ResultPresenter } from "./utils/output.ts";

export type ExtensionApi = {
  registerTargetType<T>(def: TargetTypeDef<T>): void;
  registerContribution(contribution: TargetTypeContribution): void;
  commands: CommandRegistryApi;
  options: OptionRegistryApi;
  registerHook<P extends HookPhase>(phase: P, fn: HookFn<P>, opts?: HookOpts): void;
  registerErrorHandler(fn: ErrorHandler, opts?: HookOpts): void;
  registerResultPresenter(presenter: ResultPresenter): void;
  registerOutputRenderer(renderer: OutputRenderer): void;
  logger: Logger;
  env: Readonly<Record<string, string>>;
  signal: AbortSignal;
};

export type ClipExtension = {
  name: string;
  init: (api: ExtensionApi) => void | Promise<void>;
  dispose?: () => void | Promise<void>;
};

// --- internals ---

type NormalizedOpts = { priority: number } & HookOpts;
type RegisteredHook = { fn: HookFn<HookPhase>; opts: NormalizedOpts };
type RegisteredErrorHandler = { fn: ErrorHandler; opts: NormalizedOpts };

const defaultLogger: Logger = {
  info: (msg) => process.stderr.write(`[clip] ${msg}\n`),
  warn: (msg) => process.stderr.write(`[clip:warn] ${msg}\n`),
  error: (msg) => process.stderr.write(`[clip:error] ${msg}\n`),
  debug: (msg) => {
    if (process.env.CLIP_EXT_TRACE === "1") process.stderr.write(`[clip:debug] ${msg}\n`);
  },
};

function isSubcommandCtx(ctx: HookCtx | ErrorCtx): ctx is SubcommandHookCtx | ErrorCtx {
  return "subcommand" in ctx;
}

function matchesHook(opts: HookOpts, ctx: HookCtx | ErrorCtx): boolean {
  const { match } = opts;
  if (!match) return true;
  if (!isSubcommandCtx(ctx)) return false;
  if (match.type && !match.type.includes(ctx.targetType)) return false;
  if (match.target) {
    const ok = match.target.some((m) => (typeof m === "string" ? m === ctx.targetName : m.test(ctx.targetName)));
    if (!ok) return false;
  }
  if (match.subcommand && !match.subcommand.includes(ctx.subcommand)) return false;
  return true;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = setTimeout(() => reject(new Error(`Hook timed out after ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(id);
        resolve(v);
      },
      (e) => {
        clearTimeout(id);
        reject(e);
      },
    );
  });
}

export class Registry {
  private readonly _extensions: ClipExtension[] = [];
  private readonly _initialized = new Set<string>();
  private readonly _types = new Map<string, TargetTypeDef>();
  private _api: ExtensionApi | undefined = undefined;
  private readonly _contributions = new Map<string, TargetTypeContribution>();
  private readonly _contributionOverrides = new Map<string, Partial<TargetTypeContribution>>();
  private readonly _commandHandlers = new Map<string, CommandHandler>();
  private readonly _commandSpecs = new Map<string, CommandSpec>();
  private readonly _commandDescs = new Map<string, string>();
  private readonly _commandCompletions = new Map<string, () => string>();
  private readonly _globalOptions = new Map<string, OptionSpec>();
  private readonly _globalOptionAliases = new Map<string, string>();
  private readonly _hooks: Map<HookPhase, RegisteredHook[]> = new Map([
    ["command-start", []],
    ["command-end", []],
    ["subcommand-start", []],
    ["subcommand-end", []],
  ]);
  private readonly _errorHandlers: RegisteredErrorHandler[] = [];
  private _disposed = false;
  private readonly _ac = new AbortController();

  /**
   * builtin이 소유한 command verb 세트.
   * builtin:* extension이 command를 등록하면 자동으로 추가된다.
   */
  private readonly _builtinVerbOwners = new Set<string>();

  /**
   * builtin이 소유한 target type 세트.
   * builtin:* extension이 registerTargetType()을 호출하면 자동으로 추가된다.
   */
  private readonly _builtinTypeOwners = new Set<string>();

  /**
   * manifest에서 enabled:false로 명시해 override를 허용한 target type 세트.
   */
  private readonly _allowedTypeOverrides = new Set<string>();

  register(ext: ClipExtension): void {
    if (this._extensions.some((e) => e.name === ext.name)) {
      throw new Error(`Extension "${ext.name}" is already registered.`);
    }
    this._extensions.push(ext);
  }

  hasExtension(name: string): boolean {
    return this._extensions.some((e) => e.name === name);
  }

  /**
   * builtin target type에 대한 사용자 override를 허용한다.
   */
  allowTypeOverride(type: string): void {
    this._allowedTypeOverrides.add(type);
  }

  /** 현재 초기화 중인 extension 이름 추적 (builtin 판단용) */
  private _currentExtName = "";

  private registerCommandSpec(spec: CommandSpec, overrideBuiltin: boolean): void {
    const verb = spec.name;
    const isBuiltin = this._currentExtName.startsWith("builtin:");
    const ownedByBuiltin = this._builtinVerbOwners.has(verb);
    const existing = this._commandSpecs.get(verb);

    if (ownedByBuiltin && !isBuiltin) {
      if (existing?.protected) {
        throw new Error(`Command "${verb}" is protected and cannot be overridden.`);
      }
      if (!overrideBuiltin) {
        throw new Error(
          `Command "${verb}" is owned by a builtin extension and cannot be overridden. Use api.commands.override("${verb}", spec) to replace it explicitly.`,
        );
      }
      process.stderr.write(`clip: warning: command "${verb}" overridden by user extension\n`);
    } else if (!isBuiltin && this._commandHandlers.has(verb)) {
      throw new Error(`Command "${verb}" is already registered.`);
    }

    if (isBuiltin) this._builtinVerbOwners.add(verb);
    this._commandSpecs.set(verb, spec);
    this._commandHandlers.set(verb, spec.run);
    if (spec.description ?? spec.summary) this._commandDescs.set(verb, spec.description ?? spec.summary ?? "");
    if (spec.completion) this._commandCompletions.set(verb, spec.completion);
  }

  private registerGlobalOption(spec: OptionSpec): void {
    const existing = this.resolveGlobalOptionName(spec.name);
    if (existing) throw new Error(`Global option "--${spec.name}" is already registered.`);
    this._globalOptions.set(spec.name, spec);
    for (const alias of spec.aliases ?? []) {
      const existingAlias = this.resolveGlobalOptionName(alias);
      if (existingAlias) throw new Error(`Global option alias "-${alias}" is already registered.`);
      this._globalOptionAliases.set(alias, spec.name);
    }
  }

  resolveGlobalOptionName(nameOrAlias: string): string | undefined {
    return this._globalOptions.has(nameOrAlias) ? nameOrAlias : this._globalOptionAliases.get(nameOrAlias);
  }

  async initAll(outputSink?: {
    registerResultPresenter(p: ResultPresenter): void;
    registerOutputRenderer(r: OutputRenderer): void;
  }): Promise<void> {
    const api: ExtensionApi = {
      registerTargetType: <T>(def: TargetTypeDef<T>): void => {
        const isBuiltin = this._currentExtName.startsWith("builtin:");
        if (this._builtinTypeOwners.has(def.type)) {
          // builtin이 이미 소유: 사용자 extension은 manifest override 허가 없이 덮어쓰기 불가
          if (!isBuiltin && !this._allowedTypeOverrides.has(def.type)) {
            throw new Error(
              `Target type "${def.type}" is owned by a builtin extension and cannot be overridden. To override, disable the builtin entry in your extensions manifest.`,
            );
          }
          if (!isBuiltin) {
            process.stderr.write(`clip: warning: target type "${def.type}" overridden by user extension\n`);
          }
        } else if (this._types.has(def.type)) {
          // 다른 user extension이 이미 등록한 경우 — 중복 금지
          if (!isBuiltin) {
            throw new Error(`Target type "${def.type}" is already registered.`);
          }
        }
        if (isBuiltin) this._builtinTypeOwners.add(def.type);
        this._types.set(def.type, def as TargetTypeDef);
      },
      registerContribution: (contribution: TargetTypeContribution): void => {
        const boolSet = new Set(contribution.argSpec?.booleanFlags ?? []);
        for (const f of contribution.argSpec?.valueFlags ?? []) {
          if (boolSet.has(f)) {
            throw new Error(`Extension "${this._currentExtName}": flag "--${f}" cannot be both boolean and value`);
          }
        }
        this._contributions.set(contribution.type, contribution);
      },
      commands: {
        register: (spec: CommandRegistration): void => {
          this.registerCommandSpec(spec as CommandSpec, false);
        },
        override: (name: string, spec: CommandOverride): void => {
          this.registerCommandSpec({ ...spec, name } as CommandSpec, true);
        },
      },
      options: {
        registerGlobal: (spec: OptionSpec): void => {
          this.registerGlobalOption(spec);
        },
      },
      registerHook: (phase, fn, opts = {}): void => {
        const hooks = this._hooks.get(phase);
        if (!hooks) throw new Error(`Unknown hook phase: ${phase}`);
        hooks.push({ fn: fn as HookFn<HookPhase>, opts: { priority: 100, ...opts } });
      },
      registerErrorHandler: (fn, opts = {}): void => {
        this._errorHandlers.push({ fn, opts: { priority: 100, ...opts } });
      },
      registerResultPresenter: (presenter): void => {
        outputSink?.registerResultPresenter(presenter);
      },
      registerOutputRenderer: (renderer): void => {
        outputSink?.registerOutputRenderer(renderer);
      },
      logger: defaultLogger,
      env: Object.freeze({ ...process.env } as Record<string, string>),
      signal: this._ac.signal,
    };
    this._api = api;
    for (const ext of this._extensions) {
      if (this._initialized.has(ext.name)) continue;
      this._currentExtName = ext.name;
      this._initialized.add(ext.name);
      await ext.init(api);
    }
    this._currentExtName = "";
  }

  /**
   * initAll() 이후 동적으로 추가된 extension 단건을 초기화한다.
   * extension-loader가 bindTarget() 이후에 type-matched entry를 lazy init할 때 사용.
   * initAll() 전에는 호출하지 않는다 (_api가 없음).
   */
  async initOne(extName: string): Promise<void> {
    if (!this._api) {
      throw new Error(`Registry.initOne("${extName}") called before initAll()`);
    }
    const ext = this._extensions.find((e) => e.name === extName);
    if (!ext) {
      throw new Error(`Extension "${extName}" is not registered`);
    }
    if (this._initialized.has(ext.name)) return;
    this._currentExtName = ext.name;
    this._initialized.add(ext.name);
    await ext.init(this._api);
    this._currentExtName = "";
  }

  async disposeAll(): Promise<void> {
    if (this._disposed) return;
    this._disposed = true;
    this._ac.abort();
    for (const ext of [...this._extensions].reverse()) {
      await ext.dispose?.();
    }
  }

  getTargetType(type: string): TargetTypeDef | undefined {
    return this._types.get(type);
  }

  listTypes(): string[] {
    return [...this._types.keys()];
  }

  applyManifestOverride(type: string, patch: Partial<TargetTypeContribution>): void {
    this._contributionOverrides.set(type, patch);
  }

  getContribution(type: string): TargetTypeContribution | undefined {
    const base = this._contributions.get(type);
    if (!base) return undefined;
    const ovr = this._contributionOverrides.get(type);
    if (!ovr) return base;
    return {
      ...base,
      ...ovr,
      argSpec: { ...base.argSpec, ...ovr.argSpec },
      displayHint: { ...base.displayHint, ...ovr.displayHint },
    };
  }

  listContributions(): TargetTypeContribution[] {
    const contributions: TargetTypeContribution[] = [];
    for (const type of this._contributions.keys()) {
      const contribution = this.getContribution(type);
      if (contribution) contributions.push(contribution);
    }
    return contributions;
  }

  listContributionsByPriority(): TargetTypeContribution[] {
    return this.listContributions().sort((a, b) => {
      const pa = a.dispatchPriority ?? 100;
      const pb = b.dispatchPriority ?? 100;
      return pa !== pb ? pa - pb : a.type.localeCompare(b.type);
    });
  }

  listBooleanFlags(): Set<string> {
    const out = new Set<string>();
    for (const c of this.listContributions()) {
      for (const f of c.argSpec?.booleanFlags ?? []) out.add(f);
    }
    return out;
  }

  listValueFlags(): Set<string> {
    const out = new Set<string>();
    for (const c of this.listContributions()) {
      for (const f of c.argSpec?.valueFlags ?? []) out.add(f);
    }
    return out;
  }

  getArgSpec(type: string): ArgSpec | undefined {
    return this.getContribution(type)?.argSpec;
  }

  getDisplayHint(type: string): DisplayHint | undefined {
    return this.getContribution(type)?.displayHint;
  }

  getCommandHandler(verb: string): CommandHandler | undefined {
    return this._commandHandlers.get(verb);
  }

  getCommand(verb: string): CommandSpec | undefined {
    return this._commandSpecs.get(verb);
  }

  listCommandNames(): string[] {
    return [...this._commandHandlers.keys()];
  }

  listCommands(): CommandSpec[] {
    return [...this._commandSpecs.values()];
  }

  listUserCommandNames(): string[] {
    return [...this._commandHandlers.keys()].filter((v) => !this._builtinVerbOwners.has(v));
  }

  getCommandDesc(verb: string): string | undefined {
    return this._commandDescs.get(verb);
  }

  listCommandCompletions(): Array<{ verb: string; fn: () => string }> {
    return [...this._commandCompletions.entries()].map(([verb, fn]) => ({ verb, fn }));
  }

  listGlobalOptions(): OptionSpec[] {
    return [...this._globalOptions.values()];
  }

  async runHooks(phase: HookPhase, ctx: HookCtx): Promise<HookReturn | null> {
    const base = (this._hooks.get(phase) ?? [])
      .filter((h) => matchesHook(h.opts, ctx))
      .sort((a, b) => a.opts.priority - b.opts.priority);

    // subcommand-end는 priority 내림차순 (onion 역방향)
    const ordered = phase === "subcommand-end" ? [...base].reverse() : base;
    const timeoutMs = Number(process.env.CLIP_EXT_TIMEOUT_MS ?? "5000");

    if (phase === "command-start" || phase === "command-end") {
      for (const { fn } of ordered) {
        await withTimeout(Promise.resolve(fn(ctx)), timeoutMs);
      }
      return null;
    }

    const mergedHeaders: Record<string, string> = {};
    let mergedArgs: string[] | undefined;
    let mergedSubcommand: string | undefined;
    let mergedResult: Partial<TargetResult> | undefined;
    let anyReturn = false;

    for (const { fn } of ordered) {
      const ret = await withTimeout(Promise.resolve(fn(ctx)), timeoutMs);
      if (ret === undefined) continue;
      anyReturn = true;

      if (typeof ret === "object" && "shortCircuit" in ret) {
        if (phase !== "subcommand-start") {
          process.stderr.write("clip: warning: shortCircuit from hook outside subcommand-start, ignoring\n");
          anyReturn = false; // shortCircuit이 무시되면 이 훅은 없던 것으로
          continue;
        }
        return ret;
      }

      if (typeof ret === "object" && "result" in ret) {
        if (phase !== "subcommand-end") {
          process.stderr.write("clip: warning: result rewrite from hook outside subcommand-end, ignoring\n");
          anyReturn = false;
          continue;
        }
        mergedResult = { ...mergedResult, ...(ret as { result: Partial<TargetResult> }).result };
      } else if (typeof ret === "object") {
        if (phase !== "subcommand-start") {
          anyReturn = false;
          continue;
        }
        const r = ret as { headers?: Record<string, string>; args?: string[]; subcommand?: string };
        if (r.headers) Object.assign(mergedHeaders, r.headers);
        if (r.args !== undefined) mergedArgs = r.args;
        if (r.subcommand !== undefined) mergedSubcommand = r.subcommand;
      }
    }

    if (!anyReturn) return null;
    if (mergedResult !== undefined) return { result: mergedResult };

    const out: { headers?: Record<string, string>; args?: string[]; subcommand?: string } = {};
    if (Object.keys(mergedHeaders).length > 0) out.headers = mergedHeaders;
    if (mergedArgs !== undefined) out.args = mergedArgs;
    if (mergedSubcommand !== undefined) out.subcommand = mergedSubcommand;
    return Object.keys(out).length > 0 ? out : null;
  }

  async runErrorHandlers(ctx: ErrorCtx): Promise<ErrorReturn> {
    const handlers = [...this._errorHandlers]
      .filter((h) => matchesHook(h.opts, ctx))
      .sort((a, b) => a.opts.priority - b.opts.priority);

    for (const { fn } of handlers) {
      const ret = await fn(ctx);
      if (ret !== undefined) return ret;
    }
    return undefined;
  }
}
