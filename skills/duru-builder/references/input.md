# 입력 검증 (input + input-validation)

코어의 `input()`은 커맨드 빌더에 부착하는 `CommandFeature`를 만든다. `@duru/input-validation`은 그 위에 [Standard Schema](https://github.com/standard-schema/standard-schema)(zod, valibot, arktype 등)를 얹는 슈거다.

## 1. 코어 `input()`은 feature 팩토리일 뿐

[core/cli/src/input/index.ts:3-7](../../../core/cli/src/input/index.ts):

```ts
export function input(definition: CommandInputDefinition): CommandFeature {
  return { kind: "commandInput", definition, ...metadata };
}
```

직접 쓰는 일은 거의 없다. 보통 `@duru/input-validation`의 `input(schema)`를 쓴다.

## 2. `@duru/input-validation` 표준 사용

```ts
import { z } from "zod";
import { input, param, option } from "@duru/input-validation";

cli.command("install")
  .use(input({
    params: {
      name: param(z.string().min(1), { description: "Package name" }),
    },
    options: {
      version: option(z.string().default("latest")),
      force: z.boolean().default(false),    // 스키마만 줘도 OK
    },
  }))
  .action(async (ctx) => {
    // ctx.params.name: string
    // ctx.options.version: string
    // ctx.options.force: boolean
  });
```

검증 실패 시 `validationError("input", issues)`가 throw되고, `cli.catch`에서 `isValidationError`로 잡혀 exit code 2.

## 3. 헬퍼 3종

- `param(schema, opts?)` — path 파라미터 ([`<name>`/`[name]`] 자리)
- `option(schema, opts?)` — `--name <value>` 옵션
- `flag(schema, opts?)` — `--name` boolean flag

[packages/input-validation/src/index.ts:67-83](../../../packages/input-validation/src/index.ts).

스키마만 던지면 자동 추론:

- boolean 스키마 → flag로 취급
- 그 외 → option (`--name <value>`)

`required`는 스키마가 optional인지(undefined 허용) 보고 자동 판정 — 명시는 `param(schema, { required: false })`.

## 4. 패턴은 input feature가 자동 합성한다

`input()`이 만든 feature는 `.use(input(...))`로 라우트에 부착되면 그 안의 `params`가 커맨드 패턴 끝에 자동 추가된다 ([router/index.ts:703 `appendInputParams`](../../../core/cli/src/router/index.ts)).

```ts
cli.command("greet")
  .use(input({ params: { name: param(z.string()) } }))
  .action((ctx) => ctx.exit(0, { hi: ctx.params.name }));

// 호출: myapp greet world
// ctx.params.name === "world"
```

수동 패턴(`"greet <name>"`)과 input feature를 **동시에 쓰지 말 것** — 충돌한다. 두 가지 표현 방식 중 하나만.

## 5. 처방

- ✅ 입력이 검증 가능한 형태면 `input` + Standard Schema를 쓴다 — 타입 추론과 에러 메시지가 무료
- ✅ 옵션 이름은 camelCase 키로 쓰고, CLI 표시는 라이브러리가 kebab-case로 변환 (`force` → `--force`)
- ✅ flag와 옵션이 헷갈리면 `flag(schema)`로 명시
- ✅ 스키마에 `.default(...)` 박아 두면 ctx에 그대로 흘러옴
- ❌ 패턴과 input feature를 동시에 — 한쪽만
- ❌ action 안에서 `parse` / `safeParse` 호출해 검증 — feature로 빼서 라우트 미들웨어 단계에서 일관 처리
- ❌ 검증 에러를 직접 catch해 사용자 메시지 만들기 — `cli.catch`가 `isValidationError`로 잡아 처리

## 6. Standard Schema 호환

zod / valibot / arktype 등 [Standard Schema](https://github.com/standard-schema/standard-schema) 구현체면 어떤 것이든 쓸 수 있다. Standard Schema 어댑터가 없는 라이브러리는 `~standard` 키를 직접 노출해야 한다.

## 7. ctx의 타입 추론

```ts
const greetInput = input({
  params: { name: param(z.string()) },
  options: { times: option(z.number().int().default(1)) },
});

cli.command("greet").use(greetInput).action((ctx) => {
  // ctx.params: { name: string }
  // ctx.options: { times: number }
  ...
});
```

`input(...)` 반환 타입이 `CommandFeature<TParams, TOptions>`라서, `.use(...)` 체인이 ctx 타입을 좁힌다. 캐스팅 없이도 안전.

## 8. 안티패턴

```ts
// ❌ action에서 직접 검증
.action(async (ctx) => {
  const name = ctx.params.name;
  if (typeof name !== "string" || name.length === 0) {
    return ctx.exit(2, { error: { message: "name required" } });
  }
  ...
});

// ✅ feature에서 검증
.use(input({ params: { name: param(z.string().min(1)) } }))
.action((ctx) => { /* ctx.params.name은 이미 검증됨 */ });
```
