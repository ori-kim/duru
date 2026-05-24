import { createCli } from "@duru/cli-kit";
import { type ChatOptions, defaultDeps, runChat } from "./chat.ts";

export const chatCli = createCli();

chatCli
  .command()
  .meta({ description: "edge-pi + ai-sdk-ollama 기반 agent harness PoC" })
  .group("Built-in")
  .option("--model <name>", "Ollama 모델 이름 (기본: qwen2.5:7b)")
  .option("--prompt <text>", "비대화식 단일 turn 모드. prompt 한 번만 보내고 종료")
  .action(async (ctx) => {
    const options: ChatOptions = {
      model: String(ctx.options.model ?? "qwen2.5:7b"),
      prompt: ctx.options.prompt as string | undefined,
    };
    await runChat(options, defaultDeps);
  });
