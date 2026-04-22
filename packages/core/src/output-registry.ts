import type { ExecutionResult, OutputRenderer, ResultMeta, ResultPresenter, TargetResult } from "./utils/output.ts";
import { renderJson, renderPlain } from "./utils/output.ts";

// ---------------------------------------------------------------------------
// Default presenters — TargetResult → ExecutionResult view model
// ---------------------------------------------------------------------------

/** 범용 fallback presenter: TargetResult를 call-result로 래핑 */
const fallbackPresenter: ResultPresenter = {
  type: "*",
  toViewModel(result: TargetResult, meta: ResultMeta): ExecutionResult {
    return { kind: "call-result", content: result, meta };
  },
};

// ---------------------------------------------------------------------------
// Default renderers
// ---------------------------------------------------------------------------

const plainRenderer: OutputRenderer = {
  formats: ["plain"],
  render(result: ExecutionResult): void {
    const raw = extractTargetResult(result);
    if (raw) {
      renderPlain(raw);
    } else {
      defaultRenderExecutionResult(result, "plain");
    }
  },
};

const jsonRenderer: OutputRenderer = {
  formats: ["json"],
  render(result: ExecutionResult): void {
    const raw = extractTargetResult(result);
    if (raw) {
      renderJson(raw);
    } else {
      defaultRenderExecutionResult(result, "json");
    }
  },
};

/**
 * call-result 안에 TargetResult가 들어있을 때 꺼낸다.
 * fallback presenter가 TargetResult를 content로 래핑하므로 역방향 언래핑이 필요하다.
 */
function extractTargetResult(result: ExecutionResult): TargetResult | null {
  if (
    result.kind === "call-result" &&
    result.content !== null &&
    typeof result.content === "object" &&
    "exitCode" in (result.content as object) &&
    "stdout" in (result.content as object)
  ) {
    return result.content as TargetResult;
  }
  return null;
}

/**
 * ExecutionResult의 kind에 따른 기본 렌더링.
 * fallback presenter를 거치지 않고 직접 ExecutionResult를 받았을 때 사용한다.
 */
function defaultRenderExecutionResult(result: ExecutionResult, format: "plain" | "json"): void {
  switch (result.kind) {
    case "tools": {
      const text = result.tools.map((t) => `${t.name}\t${t.description ?? ""}`).join("\n");
      if (format === "json") {
        console.log(JSON.stringify(result.tools, null, 2));
      } else {
        if (text) process.stdout.write(text + "\n");
      }
      break;
    }
    case "list": {
      if (format === "json") {
        console.log(JSON.stringify(result.items, null, 2));
      } else {
        for (const item of result.items) {
          process.stdout.write(String(item) + "\n");
        }
      }
      break;
    }
    case "help": {
      process.stdout.write(result.text + "\n");
      break;
    }
    case "error": {
      process.stderr.write(result.error.message + "\n");
      break;
    }
    case "call-result": {
      if (format === "json") {
        console.log(JSON.stringify(result.content, null, 2));
      } else {
        process.stdout.write(String(result.content ?? "") + "\n");
      }
      break;
    }
    case "stream": {
      // stream은 async 처리가 필요하므로 여기서는 경고만 출력
      process.stderr.write("clip: stream rendering requires async handler\n");
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// OutputRegistry
// ---------------------------------------------------------------------------

export class OutputRegistry {
  private readonly _presenters = new Map<string, ResultPresenter>();
  private readonly _renderers = new Map<string, OutputRenderer>();

  constructor() {
    // 기본 renderer 등록
    this.registerOutputRenderer(plainRenderer);
    this.registerOutputRenderer(jsonRenderer);
  }

  registerOutputRenderer(renderer: OutputRenderer): void {
    for (const fmt of renderer.formats) {
      this._renderers.set(fmt, renderer);
    }
  }

  registerResultPresenter(presenter: ResultPresenter): void {
    this._presenters.set(presenter.type, presenter);
  }

  /**
   * TargetResult → ExecutionResult → OutputRenderer.render
   * presenter가 없으면 fallback presenter를 사용한다.
   */
  async render(
    result: TargetResult,
    targetType: string,
    meta: ResultMeta,
    format = "plain",
  ): Promise<void> {
    const presenter = this._presenters.get(targetType) ?? fallbackPresenter;
    const vm = presenter.toViewModel(result, meta);

    const renderer = this._renderers.get(format) ?? this._renderers.get("plain")!;
    await renderer.render(vm, { format });
  }

  /**
   * 이미 ExecutionResult가 있는 경우 직접 렌더링한다.
   */
  async renderViewModel(vm: ExecutionResult, format = "plain"): Promise<void> {
    const renderer = this._renderers.get(format) ?? this._renderers.get("plain")!;
    await renderer.render(vm, { format });
  }
}

/** 싱글톤 인스턴스 (clip.ts에서 import해서 사용) */
export const outputRegistry = new OutputRegistry();
