# 플러그인 (`createPlugin`과 그 위의 슈거)

duru의 모든 정적 확장은 `createPlugin` 하나로 시작한다. 다른 모든 헬퍼(`option`, `context`, `renderer`)는 이 위에 한 줄짜리 슈거다.

## 1. 한 가지 기본형

[plugin/index.ts:16-20](../../../core/cli/src/plugin/index.ts):

```ts
export function createPlugin<TOptions, TValues>(
  install: (api: CliPluginApi) => void | Promise<void>,
): CliPlugin<TOptions, TValues>;
```

`install` 함수가 받는 `api`로 할 수 있는 것은 4가지뿐이다:

- `api.cli` — cli 인스턴스 접근 (라우터 추가 등)
- `api.option(def)` — 글로벌 옵션
- `api.middleware(mw)` — 글로벌 미들웨어
- `api.renderer(r)` / `api.defaultRenderer(id)` — 렌더러

**원칙**: 이 4가지로 표현 못 하는 동작은 플러그인이 아니라 별도 라이브러리다. 새 메서드를 `api`에 추가하지 마라.

## 2. 슈거 4종은 모두 createPlugin이다

[plugin/index.ts:26-51](../../../core/cli/src/plugin/index.ts):

```ts
// option(spec, desc) — 옵션 하나만 등록하는 플러그인
export function option(spec, desc) {
  return createPlugin((api) => { api.option(parseOptionSpec(spec, desc)); });
}

// context<T>(mw) — 미들웨어 하나 등록하고 ctx 타입 확장
export function context<TValues>(middleware) {
  return createPlugin<EmptyObject, TValues>((api) => {
    if (middleware) api.middleware(middleware);
  });
}

// renderer(...renderers) — 여러 렌더러 + 첫 렌더러가 default
export function renderer(...renderers) {
  return createPlugin((api) => {
    for (const r of renderers) api.renderer(r);
    if (renderers[0]) api.defaultRenderer(renderers[0].id);
  });
}
```

`adaptResult`는 미들웨어 함수를 직접 리턴하므로 슈거라기보다 미들웨어 팩토리지만, **`cli.use(mw)`가 받아들이는 형태**라는 점에서 같은 계열이다.

## 3. 환원 규칙

새 헬퍼를 만들고 싶으면 **반드시 `createPlugin`을 한 번 부르는 함수**로 만들어라:

```ts
// ✅ 슈거를 한 줄로
export function withAuth(loader: () => Promise<User>) {
  return createPlugin<EmptyObject, { user: User }>((api) => {
    api.middleware(async (ctx, next) => {
      ctx.values.user = await loader();
      return next();
    });
  });
}

// 사용
cli.use(withAuth(loadUser));
```

이 규칙을 어기는 헬퍼는 만들지 마라:

- ❌ `cli` 인스턴스를 캡처해서 나중에 호출하는 헬퍼
- ❌ `createPlugin`을 우회하고 직접 미들웨어 배열에 push하는 헬퍼
- ❌ 사용 시점이 `cli.use(...)`가 아닌 다른 메서드인 헬퍼

## 4. install 함수 안에서의 비동기

```ts
const plugin = createPlugin(async (api) => {
  const config = await readConfig();   // OK — install 동안 await 가능
  api.option(...);
  api.middleware(async (ctx, next) => {
    if (config.guard) { ... }
    return next();
  });
});
```

`install`은 async OK. 단 **부팅이 느려지는 비동기 작업은 미들웨어 내부로**. install은 가능한 한 짧게.

## 5. 정적 vs 버추얼의 선택

| 조건 | 권장 |
|------|------|
| 앱 안에서 항상 켜져 있어야 함 (렌더러, 글로벌 옵션, 인증) | 정적 (`createPlugin`) |
| 사용자가 설치/제거할 수 있어야 함 | 버추얼 (`virtualPlugin`) — [virtual-plugin.md](virtual-plugin.md) 참고 |
| 비매칭 시 로드 비용을 아끼고 싶음 | 버추얼 |
| 다른 정적 플러그인이 의존 | 정적 |

## 6. 처방

- ✅ 플러그인 한 개에 의미 단위 하나. 큰 플러그인을 만들지 말고 작은 플러그인을 여러 개 `cli.use`로 합쳐라
- ✅ 플러그인 이름은 `xxxPlugin` 또는 헬퍼 함수 이름 그대로 (`textRendererPlugin`, `env`, `version`)
- ✅ 플러그인이 ctx 타입을 확장하면 `context<T>` 슈거로 표현해 타입 추론을 살린다
- ❌ install 안에서 cli.run을 호출하거나 외부 cli 인스턴스를 만들지 말 것
- ❌ `api.middleware`로 다른 플러그인 흐름에 끼어드는 코드 — 미들웨어는 자기 책임만

## 7. `isCliPlugin`은 언제 쓰나

```ts
import { isCliPlugin } from "@duru/cli-kit";

if (isCliPlugin(value)) cli.use(value);
```

플러그인 컬렉션을 동적으로 받아 분기할 때만. 일반 작성에서는 필요 없다.
