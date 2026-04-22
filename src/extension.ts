export type TargetResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type Tool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

export type ExecutorContext = {
  targetName: string;
  subcommand: string;
  args: string[];
  headers: Record<string, string>;
  dryRun: boolean;
  jsonMode: boolean;
  passthrough: boolean;
};

export type Executor<T> = (target: T, ctx: ExecutorContext) => Promise<TargetResult>;

export type HookPhase = "toolcall" | "beforeExecute" | "afterExecute";

export type HookCtx = Readonly<{
  phase: HookPhase;
  targetName: string;
  targetType: string;
  target: Readonly<unknown>;
  subcommand: string;
  args: readonly string[];
  headers: Record<string, string>;
  dryRun: boolean;
  jsonMode: boolean;
  passthrough: boolean;
  result?: TargetResult;
}>;

export type HookReturn =
  | void
  | { headers?: Record<string, string>; args?: string[]; subcommand?: string }
  | { shortCircuit: TargetResult }
  | { result: Partial<TargetResult> };

export type HookFn = (ctx: HookCtx) => HookReturn | Promise<HookReturn>;

export type ErrorCtx = HookCtx & { error: unknown; aclDenied?: boolean };
export type ErrorReturn = void | { result: TargetResult } | { rethrow: unknown };
export type ErrorHandler = (ctx: ErrorCtx) => ErrorReturn | Promise<ErrorReturn>;

// 구조적 타이핑으로 zod 직접 의존 없이 schema 정의
export type ParseResult<T> = { success: true; data: T } | { success: false; error: { message: string } };

export type AnySchema<T = unknown> = {
  safeParse: (input: unknown) => ParseResult<T>;
};

export type NormalizeCtx = {
  /** configDir: target의 config.yml이 있는 디렉터리 절대 경로 */
  configDir: string;
  /** env: 이 target에 적용된 환경 변수 (global + workspace + target .env 병합 결과) */
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

export type ListOpts = {
  bound: Set<string>;
  activeWorkspace: string | null;
  tty: boolean;
  color: (code: string, text: string) => string;
  wsTag: (name: string) => string;
  bind: (name: string) => string;
};

export type AddArgs = {
  name: string;
  positionals: string[];
  flags: Record<string, string>;
  allow: string[] | undefined;
  deny: string[] | undefined;
  addOpts: { global: boolean } | undefined;
};

/**
 * TargetTypeContribution: CLI-layer の コントリビューション インターフェース.
 * 각 builtin이 CLI 명령별 렌더/핸들러를 등록한다.
 */
export type TargetTypeContribution = {
  type: string;
  /** clip list — 해당 타입의 target 한 줄 렌더링 */
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

// --- InternalCommandHandler ---

export type InternalCommandCtx = {
  args: string[];
};

export type InternalCommandHandler = (ctx: InternalCommandCtx) => Promise<void>;

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

export type ExtensionApi = {
  registerTargetType<T>(def: TargetTypeDef<T>): void;
  registerContribution(contribution: TargetTypeContribution): void;
  registerInternalCommand(verb: string, handler: InternalCommandHandler): void;
  registerHook(phase: HookPhase, fn: HookFn, opts?: HookOpts): void;
  registerErrorHandler(fn: ErrorHandler, opts?: HookOpts): void;
  registerResultPresenter(presenter: import("./utils/output.ts").ResultPresenter): void;
  registerOutputRenderer(renderer: import("./utils/output.ts").OutputRenderer): void;
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
type RegisteredHook = { fn: HookFn; opts: NormalizedOpts };
type RegisteredErrorHandler = { fn: ErrorHandler; opts: NormalizedOpts };

const defaultLogger: Logger = {
  info: (msg) => process.stderr.write(`[clip] ${msg}\n`),
  warn: (msg) => process.stderr.write(`[clip:warn] ${msg}\n`),
  error: (msg) => process.stderr.write(`[clip:error] ${msg}\n`),
  debug: (msg) => {
    if (process.env["CLIP_EXT_TRACE"] === "1") process.stderr.write(`[clip:debug] ${msg}\n`);
  },
};

function matchesHook(opts: HookOpts, ctx: HookCtx): boolean {
  const { match } = opts;
  if (!match) return true;
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
  private readonly _contributions = new Map<string, TargetTypeContribution>();
  private readonly _internalCommands = new Map<string, InternalCommandHandler>();
  private readonly _hooks: Map<HookPhase, RegisteredHook[]> = new Map([
    ["toolcall", []],
    ["beforeExecute", []],
    ["afterExecute", []],
  ]);
  private readonly _errorHandlers: RegisteredErrorHandler[] = [];
  private _disposed = false;
  private readonly _ac = new AbortController();

  register(ext: ClipExtension): void {
    if (this._extensions.some((e) => e.name === ext.name)) {
      throw new Error(`Extension "${ext.name}" is already registered.`);
    }
    this._extensions.push(ext);
  }

  async initAll(): Promise<void> {
    // outputRegistry는 circular import을 피하기 위해 동적 import
    const { outputRegistry } = await import("./output-registry.ts");
    const api: ExtensionApi = {
      registerTargetType: <T>(def: TargetTypeDef<T>): void => {
        if (this._types.has(def.type)) {
          if (process.env["CLIP_EXT_ALLOW_OVERRIDE"] !== "1") {
            throw new Error(`Target type "${def.type}" is already registered.`);
          }
          process.stderr.write(`clip: warning: target type "${def.type}" overridden\n`);
        }
        this._types.set(def.type, def as TargetTypeDef);
      },
      registerContribution: (contribution: TargetTypeContribution): void => {
        this._contributions.set(contribution.type, contribution);
      },
      registerInternalCommand: (verb: string, handler: InternalCommandHandler): void => {
        this._internalCommands.set(verb, handler);
      },
      registerHook: (phase, fn, opts = {}): void => {
        (this._hooks.get(phase) ?? []).push({ fn, opts: { priority: 100, ...opts } });
      },
      registerErrorHandler: (fn, opts = {}): void => {
        this._errorHandlers.push({ fn, opts: { priority: 100, ...opts } });
      },
      registerResultPresenter: (presenter): void => {
        outputRegistry.registerResultPresenter(presenter);
      },
      registerOutputRenderer: (renderer): void => {
        outputRegistry.registerOutputRenderer(renderer);
      },
      logger: defaultLogger,
      env: Object.freeze({ ...process.env } as Record<string, string>),
      signal: this._ac.signal,
    };
    for (const ext of this._extensions) {
      if (this._initialized.has(ext.name)) continue;
      this._initialized.add(ext.name);
      await ext.init(api);
    }
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

  getContribution(type: string): TargetTypeContribution | undefined {
    return this._contributions.get(type);
  }

  listContributions(): TargetTypeContribution[] {
    return [...this._contributions.values()];
  }

  getInternalCommand(verb: string): InternalCommandHandler | undefined {
    return this._internalCommands.get(verb);
  }

  listInternalVerbs(): string[] {
    return [...this._internalCommands.keys()];
  }

  async runHooks(phase: HookPhase, ctx: HookCtx): Promise<HookReturn | null> {
    const base = (this._hooks.get(phase) ?? [])
      .filter((h) => matchesHook(h.opts, ctx))
      .sort((a, b) => a.opts.priority - b.opts.priority);

    // afterExecute는 priority 내림차순 (onion 역방향)
    const ordered = phase === "afterExecute" ? [...base].reverse() : base;
    const timeoutMs = Number(process.env["CLIP_EXT_TIMEOUT_MS"] ?? "5000");

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
        if (phase !== "beforeExecute") {
          process.stderr.write("clip: warning: shortCircuit from hook outside beforeExecute, ignoring\n");
          anyReturn = false; // shortCircuit이 무시되면 이 훅은 없던 것으로
          continue;
        }
        return ret;
      }

      if (typeof ret === "object" && "result" in ret) {
        mergedResult = { ...mergedResult, ...(ret as { result: Partial<TargetResult> }).result };
      } else if (typeof ret === "object") {
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
