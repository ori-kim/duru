# 옵션

옵션도 결국 미들웨어 체인 위에 얹힌 플러그인이다. `cli.option(spec, desc)`는 내부적으로 `cli.use(option(spec, desc))`를 호출한다 ([cli/index.ts:94-97](../../../core/cli/src/cli/index.ts)).

## 1. spec 문법

```ts
cli.option("--debug", "Enable debug logs");                    // boolean flag
cli.option("--config <path>", "Config file path");             // 값 필수
cli.option("--tag [tag]", "Optional filter tag");              // 값 선택
cli.option("--include <name...>", "Repeatable include");       // 가변 길이 (배열)
cli.option("-v, --verbose", "Verbose output");                 // short + long
```

규칙:

- `<x>` — 필수 값
- `[x]` — 선택 값
- `<x...>` 또는 `[x...]` — 가변 길이 (배열로 들어옴)
- `-x, --xxx` — short alias
- 이름 없는 자체는 boolean flag

내부 파서는 `parseOptionSpec` ([core/cli/src/options/](../../../core/cli/src/options/)).

## 2. 글로벌 vs 커맨드

```ts
// 글로벌 — 모든 커맨드에서 사용 가능
cli.option("--json", "Output as JSON");

// 커맨드 — 그 커맨드에서만
cli.command("list")
  .option("--tag <tag>", "Filter by tag")
  .action(...);
```

**원칙**: 가능한 한 좁은 쪽에 등록한다. `--tag`가 list에서만 의미 있다면 글로벌로 빼지 말 것.

## 3. 옵션 값 읽기

```ts
.action(async (ctx) => {
  const opts = ctx.options as { tag?: string; debug?: boolean };
  if (opts.debug) ...;
});
```

타입은 cast로 좁힌다. 자동 추론을 원하면 `option<TSpec>` 슈거를 직접 사용해 제네릭을 흘리거나, [input.md](input.md)의 스키마 검증을 쓴다.

## 4. cli.option은 미들웨어 체인 위의 슈거다

[cli/index.ts:94-97](../../../core/cli/src/cli/index.ts):

```ts
option<TSpec extends string>(spec, description) {
  defaultRouter.option(spec, description);
  return cli.use(optionPlugin(spec, description)) as never;
}
```

즉 옵션 등록은:

1. 기본 라우터에 옵션 정의 추가
2. **`cli.use(optionPlugin(...))`** — 플러그인 체인에 얹힘

별도 옵션 시스템이 따로 있는 게 아니라 **같은 `cli.use` 경로**를 탄다. 이 일관성을 깨는 코드는 만들지 마라.

## 5. fallback (환경변수 등)

`OptionFallbackProvider`는 옵션이 명시되지 않았을 때 다른 소스에서 값을 주입한다. `@duru/env`가 대표 사용처. 직접 만들 거라면 `createPlugin` 안에서 `api`에 등록 — 패턴은 `@duru/env` 참고.

## 6. 처방

- ✅ boolean flag는 디폴트 `false`. `--no-xxx` 변종은 라이브러리가 자동 처리하지 않으니, 정말 필요하면 별도 플래그로
- ✅ 값 있는 옵션은 `<x>`(필수)와 `[x]`(선택)를 정확히 구분
- ✅ short alias는 정말 자주 쓰는 것만. 충돌 위험
- ✅ 옵션 이름은 kebab-case (`--dry-run`), ctx에서는 camelCase (`ctx.options.dryRun`)
- ❌ 패턴 안에 옵션 넣지 말 것 — `command("list --json")` 같은 거 ❌. 옵션은 `.option`으로만
- ❌ 글로벌 옵션을 남발하지 말 것. 커맨드 단위로 충분한 건 거기서

## 7. 흔한 안티패턴

```ts
// ❌ 옵션 분기를 action에 떠넘김
.action(async (ctx) => {
  if (ctx.options.json) return ctx.exit(0, data, true);
  process.stdout.write(format(data));
  return ctx.exit(0, data);
});

// ✅ 렌더러가 옵션을 보고 알아서 처리 (jsonRendererPlugin이 --json 보고 동작)
.action(async (ctx) => ctx.exit(0, data));
```

옵션을 보고 동작이 달라지는 로직이 여러 곳에 흩어진다면 미들웨어로 추출.
