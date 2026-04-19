export type { TargetResult } from "../extension.ts";
import type { TargetResult } from "../extension.ts";

export type OutputMode = "plain" | "json";

export function formatOutput(result: TargetResult, mode: OutputMode): number {
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }

  if (mode === "json") {
    const text = result.stdout.trim();
    if (!text) {
      return result.exitCode;
    }
    try {
      const parsed = JSON.parse(text);
      console.log(JSON.stringify(parsed, null, 2));
    } catch {
      // JSON 파싱 실패 시 output 필드로 래핑
      console.log(JSON.stringify({ output: text }, null, 2));
    }
  } else {
    if (result.stdout) {
      process.stdout.write(result.stdout);
      // 줄바꿈이 없으면 추가
      if (!result.stdout.endsWith("\n")) process.stdout.write("\n");
    }
  }

  return result.exitCode;
}
