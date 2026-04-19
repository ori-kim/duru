# 확장 (Extensions)

clip은 훅 기반 확장 시스템을 지원합니다. 새로운 target type 추가, 헤더 주입, 호출 로깅, 실행 단락 등을 clip 자체를 수정하지 않고 구현할 수 있습니다.

확장 파일은 `~/.clip/extensions/` 디렉토리에 `.ts` 파일로 작성합니다. clip이 시작할 때 알파벳 순서로 로드됩니다.

## 빠른 시작

`~/.clip/extensions/trace.ts` 생성:

```ts
import type { ClipExtension } from "../../Documents/personal/clip/types/extension.d.ts";
// 또는: types/extension.d.ts를 ~/.clip/extensions/에 복사 후 "./extension.d.ts"로 import

export default {
  name: "my:trace",
  init(api) {
    api.registerHook("toolcall", (ctx) => {
      api.logger.info(`→ ${ctx.targetName} ${ctx.subcommand} ${ctx.args.join(" ")}`);
    });
  },
} satisfies ClipExtension;
```

실행:

```sh
clip gh pr list
# stderr: [clip] → gh pr list
```

## 라이프사이클 훅

각 훅은 특정 단계에서 실행됩니다. 단계별로 허용되는 반환값이 다릅니다.

| 단계 | 시점 | 반환 가능 |
|------|------|-----------|
| `toolcall` | alias 확장 후, ACL 검사 전 | `void` (관찰 전용) |
| `beforeExecute` | ACL 검사 후, executor 실행 전 | headers/args/subcommand 수정, 또는 단락 |
| `afterExecute` | executor 반환 후 | result 부분 머지 |

### 관찰 (toolcall)

```ts
api.registerHook("toolcall", (ctx) => {
  console.error(`[감사] ${ctx.targetName}.${ctx.subcommand}`);
});
```

### 헤더 주입 (beforeExecute)

```ts
api.registerHook("beforeExecute", async (ctx) => {
  if (ctx.targetType !== "api") return;
  const token = await fetchToken(api.env["TOKEN_URL"]!);
  return { headers: { Authorization: `Bearer ${token}` } };
});
```

### 단락 처리 (beforeExecute)

```ts
api.registerHook("beforeExecute", (ctx) => {
  if (ctx.dryRun) {
    return { shortCircuit: { exitCode: 0, stdout: "[dry-run] 건너뜀", stderr: "" } };
  }
});
```

### 결과 재작성 (afterExecute)

```ts
api.registerHook("afterExecute", (ctx) => {
  if (!ctx.result) return;
  return { result: { stdout: ctx.result.stdout.replace(/secret=\S+/g, "secret=***") } };
});
```

### type / target / subcommand 필터

```ts
api.registerHook("beforeExecute", injectAuth, {
  match: { type: ["api", "graphql"], target: [/^prod-/] },
});
```

## 새 target type 등록

확장으로 완전히 새로운 target type을 추가할 수 있습니다.

```ts
// ~/.clip/extensions/sqlite.ts
import { z } from "zod";
import type { ClipExtension } from "./extension.d.ts";

const schema = z.object({
  file: z.string(),
  readOnly: z.boolean().default(false),
});

export default {
  name: "builtin-user:sqlite",
  init(api) {
    api.registerTargetType({
      type: "sqlite",
      schema,
      async executor(target, ctx) {
        if (ctx.subcommand !== "query") {
          return { exitCode: 1, stdout: "", stderr: `알 수 없는 subcommand: ${ctx.subcommand}` };
        }
        const sql = ctx.args.join(" ");
        const flags = target.readOnly ? ["--readonly"] : [];
        const proc = Bun.spawn(["sqlite3", ...flags, target.file, sql]);
        const stdout = await new Response(proc.stdout).text();
        const stderr = await new Response(proc.stderr).text();
        return { exitCode: await proc.exited, stdout, stderr };
      },
    });
  },
} satisfies ClipExtension;
```

새 type으로 target 등록:

```yaml
# ~/.clip/target/sqlite/mydb/config.yml
file: ~/data/mydb.sqlite
readOnly: true
```

```sh
clip mydb query "SELECT * FROM users LIMIT 5"
```

## 에러 핸들러

```ts
api.registerErrorHandler(async (ctx) => {
  if (ctx.aclDenied) return; // ACL 거부는 전파
  await reportToSlack(`clip 에러 in ${ctx.targetName}: ${ctx.error}`);
  // undefined 반환 → 원래 에러 rethrow
});
```

## 훅 priority

priority 값이 작을수록 `beforeExecute` / `toolcall` 에서 먼저 실행되고, `afterExecute` 에서는 나중에 실행됩니다 (onion 모델).

```ts
api.registerHook("beforeExecute", injectTokenA, { priority: 10 });
api.registerHook("beforeExecute", injectTokenB, { priority: 20 }); // A 다음 실행
```

여러 훅이 `headers`를 반환하면 머지됩니다 (같은 키는 나중 훅이 승리).

## 라이프사이클

```
init()  →  [toolcall 훅]  →  [beforeExecute 훅]  →  executor  →  [afterExecute 훅]  →  result
                                                                           ↓
                                                         [throw 시 errorHandler]
dispose()  ←  SIGINT / beforeExit
```

## 확장 비활성화

`CLIP_NO_EXTENSIONS=1`로 `~/.clip/extensions/` 로딩을 건너뜁니다. 내장 target type은 계속 로드됩니다.

```sh
CLIP_NO_EXTENSIONS=1 clip gh pr list
```

## TypeScript 타입

공개 타입은 clip 저장소의 `types/extension.d.ts`에 있습니다. 타입 체크를 위해 extensions 디렉토리에 복사하세요:

```sh
cp "$(dirname $(which clip))/../lib/clip/types/extension.d.ts" ~/.clip/extensions/
```
