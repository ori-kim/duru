export type TargetResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type OutputMode = "plain" | "json";
export type TargetType = "mcp" | "cli" | "api";

export function formatOutput(result: TargetResult, mode: OutputMode, _targetType: TargetType): void {
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }

  if (mode === "json") {
    const text = result.stdout.trim();
    if (!text) {
      if (result.exitCode !== 0) process.exit(result.exitCode);
      return;
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

  process.exit(result.exitCode);
}
