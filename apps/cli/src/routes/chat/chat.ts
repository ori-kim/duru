import { ClackCancelError, text as clackText } from "@duru/clack/prompt";
import { CodingAgent, createMemoryRuntime } from "edge-pi";
import { ollama } from "ai-sdk-ollama";

export type ChatOptions = {
  model: string;
  /** 비대화식 단일 turn 모드. 값이 있으면 prompt 한 번만 보내고 종료. */
  prompt?: string;
};

export type ChatDeps = {
  stdout: { write(chunk: string): unknown };
  stderr: { write(chunk: string): unknown };
  promptUser: () => Promise<string>;
  cwd: string;
};

function die(message: string): never {
  throw new Error(message);
}

async function defaultPromptUser(): Promise<string> {
  if (!process.stdin.isTTY) {
    die("Chat requires an interactive TTY.");
  }
  return await clackText({
    message: "You",
    placeholder: "(Ctrl+C로 종료)",
  });
}

export const defaultDeps: ChatDeps = {
  stdout: process.stdout,
  stderr: process.stderr,
  promptUser: defaultPromptUser,
  cwd: process.cwd(),
};

export async function runChat(options: ChatOptions, deps: ChatDeps = defaultDeps): Promise<void> {
  const runtime = createMemoryRuntime({ rootdir: deps.cwd });
  const agent = new CodingAgent({
    model: ollama(options.model),
    runtime,
    toolSet: "coding",
  });

  // 비대화식 단일 turn 모드 (smoke test 용)
  if (options.prompt) {
    deps.stderr.write(`Edge-PI chat (model=${options.model}, single turn)\n`);
    const result = await agent.stream({ prompt: options.prompt });
    for await (const chunk of result.textStream) {
      deps.stdout.write(chunk);
    }
    deps.stdout.write("\n");
    return;
  }

  deps.stderr.write(`Edge-PI chat (model=${options.model}). Ctrl+C로 종료.\n\n`);

  try {
    while (true) {
      const userMessage = await deps.promptUser();
      const trimmed = userMessage?.trim() ?? "";
      if (!trimmed) continue;

      const result = await agent.stream({ prompt: trimmed });
      for await (const chunk of result.textStream) {
        deps.stdout.write(chunk);
      }
      deps.stdout.write("\n\n");
    }
  } catch (error) {
    if (error instanceof ClackCancelError) {
      deps.stderr.write("\n종료합니다.\n");
      return;
    }
    throw error;
  }
}
