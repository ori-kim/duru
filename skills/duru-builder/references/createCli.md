# createCli

CLI 인스턴스를 만드는 진입점. `@duru/cli-kit`의 `createCli(options)`가 전부다.

## 1. 시그니처

```ts
import { createCli } from "@duru/cli-kit";

const cli = createCli({ name: "myapp" });
```

리턴값은 체이너블한 `Cli`. 자체적으로 기본 라우터를 내장하므로 `cli.command(...)`를 바로 쓸 수 있다 ([cli/index.ts:88-93](../../../core/cli/src/cli/index.ts)).

| 메서드 | 역할 |
|--------|------|
| `cli.use(plugin \| middleware)` | 정적 플러그인 또는 미들웨어 추가 |
| `cli.option(spec, desc?)` | 글로벌 옵션 (내부적으로 `cli.use(optionPlugin(...))` 호출) |
| `cli.command(pattern)` | 기본 라우터에 커맨드 등록, `CommandBuilder` 리턴 |
| `cli.subCommand(name, router)` | 별도 라우터를 서브커맨드 그룹으로 마운트 |
| `cli.notFound(handler)` | 매칭 실패 시 핸들러 |
| `cli.catch(handler)` | 라우트 에러 핸들러 |
| `cli.run(argv?, opts?)` | 실행 |

## 2. 부팅 체인의 순서가 의미를 갖는다

[apps/cli/src/app.ts:28-40](../../../apps/cli/src/app.ts)가 표준 형태다:

```ts
const cli = createCli({ name: "duru" })
  .use(adaptResult({ when, match, adapt }))   // 1. 결과 후처리 미들웨어
  .use(textRendererPlugin())                  // 2. 렌더러
  .use(jsonRendererPlugin())                  // 3. 렌더러
  .use(version())                             // 4. --version 플래그
  .use(env())                                 // 5. 환경변수를 ctx로
  .use(gateway.plugin)                        // 6. 도메인 플러그인
  .subCommand("gateway", gateway.cli)         // 7. 서브커맨드
  .subCommand("update", updateCli)
  .subCommand("plugin", pluginManageCli)
  .use(createAppCompletionPlugin())
  .use(help())                                // 8. help (반드시 마지막 근처)
  .use(virtualPlugins({ home }, argv));       // 9. 동적 로드는 가장 마지막
```

### 순서 규칙

- **결과 후처리 미들웨어(`adaptResult`)는 먼저** — 미들웨어 체인은 후입선출이라 먼저 등록한 게 결과를 마지막에 본다
- **렌더러는 어디 둬도 OK** — 등록만 되면 됨. 단 가장 먼저 등록한 게 default
- **`help()`는 다른 모든 커맨드/플러그인 뒤** — help가 그동안 등록된 커맨드 목록을 본다
- **`virtualPlugins()`는 마지막** — 매니페스트 플러그인이 정적 플러그인 위에 얹히는 순서를 보장

## 3. notFound / catch는 옵션이 아니다

```ts
cli.notFound((ctx) => ctx.exit(1, {
  error: { message: `Unknown command: ${ctx.argv.join(" ")}` },
  hint: "Run myapp --help",
}));

cli.catch((ctx) => {
  if (isValidationError(ctx.error)) return ctx.exit(2, ctx.error);
  return ctx.exit(1, { error: { message: String(ctx.error) } });
});
```

원칙:

- **항상 둘 다 등록**한다 — 사용자가 잘못된 verb를 쳤을 때 무반응으로 끝내지 않는다
- exit code 관례: `0` 성공, `1` 사용자/환경 오류, `2` 입력 검증 실패
- `isValidationError`로 검증 에러를 분리해 별도 exit code

## 4. 처방

- ✅ entry는 함수로 만들고 `app.test.ts`에서 호출하기 쉽게 둔다 ([apps/cli/src/app.ts:13-22](../../../apps/cli/src/app.ts) 패턴)
- ✅ 부팅에 비동기가 필요하면 (예: file-store 초기화) 함수를 async로 감싸고, 안에서 `await`한 결과를 `cli.use(...)`에 넘긴다
- ✅ `cli.run`이 리턴하는 결과를 그대로 `process.exit(result.exitCode)`로 흘리거나 await만 하고 끝
- ❌ `createCli`를 여러 번 호출해서 합치는 구조 — 만들지 말 것. 하나의 `cli`에 다 얹는다
- ❌ `cli.run` 후에 cli를 재사용 — 의도되지 않음

## 5. 미니 예제

```ts
import { createCli, isValidationError } from "@duru/cli-kit";
import { textRendererPlugin } from "@duru/renderer-text";
import { jsonRendererPlugin } from "@duru/renderer-json";

export function createMyCli() {
  const cli = createCli({ name: "myapp" })
    .use(textRendererPlugin())
    .use(jsonRendererPlugin())
    .option("--debug", "Enable debug logs");

  cli.command("hello [name]").action((ctx) => {
    const name = (ctx.params as { name?: string }).name ?? "world";
    return ctx.exit(0, { greeting: `hi, ${name}` });
  });

  cli.notFound((ctx) => ctx.exit(1, { error: { message: "Unknown command" } }));
  cli.catch((ctx) => isValidationError(ctx.error)
    ? ctx.exit(2, ctx.error)
    : ctx.exit(1, { error: { message: String(ctx.error) } }));

  return cli;
}
```
