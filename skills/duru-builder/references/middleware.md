# 미들웨어

duru의 모든 실행은 하나의 파이프라인을 따라간다. **action도 그 끝일 뿐**이다.

## 1. 파이프라인은 단순하다

[middleware/pipeline.ts:3-18](../../../core/cli/src/middleware/pipeline.ts):

```ts
async function dispatch(nextIndex) {
  if (nextIndex <= index) throw new Error("next() called multiple times");
  index = nextIndex;
  const fn = middleware[nextIndex];
  return fn ? fn(ctx, () => dispatch(nextIndex + 1)) : action();
}
```

미들웨어 배열을 순서대로 dispatch하다가 끝에 `action()`을 호출. 끝.

따라서:

- **action은 미들웨어의 종점**이다. 미들웨어가 `await next()`하면 결국 action을 부른다.
- **`next()` 두 번 호출은 throw**. 분기 후에 한 쪽에서만 부르거나, 호출 안 하고 직접 결과를 만들거나.

## 2. 시그니처

```ts
type Middleware<O, P, V> = (
  ctx: Context<O, P, V>,
  next: () => Promise<ActionResult>,
) => Awaitable<ActionResult>;
```

원칙:

- 통과시키면 `return next()` — await 안 해도 OK
- 결과를 가공하면 `const result = await next(); return modify(result);`
- 흐름을 막으면 `next()`를 부르지 않고 직접 `ctx.exit(...)` 또는 새 결과 리턴
- 에러는 catch 후 re-throw 또는 직접 처리. 미들웨어에서 삼키지 말 것

## 3. 어디에 둘 것인가

| 어디에 등록 | 적용 범위 | API |
|-----------|---------|-----|
| `cli.use(mw)` | 모든 커맨드 (글로벌) | `cli.use(async (ctx, next) => ...)` |
| `createPlugin` 안에서 `api.middleware(mw)` | 글로벌, 플러그인으로 캡슐화 | `api.middleware(mw)` |
| `router.command(...).use(mw)` | 그 커맨드만 | (라우트 미들웨어) |

**원칙**: 같은 효과가 두 군데에서 가능하면 더 좁은 쪽에 둔다. 커맨드 단위면 라우트로, 한 그룹이면 라우터로, 전역이면 cli로.

## 4. 결과 후처리도 미들웨어다

`adaptResult` ([middleware/adapt-result.ts](../../../core/cli/src/middleware/adapt-result.ts)) 패턴:

```ts
cli.use(adaptResult({
  when: (ctx) => !ctx.options.json,
  match: isHelpDocument,
  adapt: formatHelp,
}));
```

action이 만든 결과의 타입을 매치해서 다른 형태로 변환. 별도 hook이나 후처리 시스템 같은 거 없이 그냥 미들웨어다.

새로 후처리가 필요하면 `adaptResult`를 만들어 `cli.use` — 새 메커니즘을 도입하지 않는다.

## 5. 처방

- ✅ 부수효과(로그·캡처·인증·재시도)는 미들웨어로
- ✅ action 안에서 try/finally로 로그 남기는 패턴 보이면 미들웨어로 추출
- ✅ 인증, 입력 정규화, 캐시 — 전부 미들웨어
- ✅ "before X" / "after X"가 떠오르면 무조건 미들웨어
- ❌ action 안에서 다른 action을 부르는 구조 (`runPipeline`을 우회) — 만들지 말 것
- ❌ 미들웨어가 자체적으로 cli를 보관·재실행하는 구조 — 흐름은 한 방향

## 6. 안티패턴

```ts
// ❌ action이 부수효과를 떠안음
.action(async (ctx) => {
  console.log("start");
  try {
    const result = await doWork();
    await audit.log(result);
    return ctx.exit(0, result);
  } catch (err) {
    await audit.error(err);
    throw err;
  }
});

// ✅ 부수효과는 미들웨어로 분리
cli.use(async (ctx, next) => {
  try {
    const result = await next();
    await audit.log(result);
    return result;
  } catch (err) {
    await audit.error(err);
    throw err;
  }
});

.action(async (ctx) => ctx.exit(0, await doWork()));
```

## 7. ctx.values로 미들웨어 간 데이터 전달

```ts
cli.use(context<{ user: User }>(async (ctx, next) => {
  ctx.values.user = await loadUser();
  return next();
}));

.action((ctx) => ctx.exit(0, { hello: ctx.values.user.name }));
```

`context<T>(mw)`는 `createPlugin` 슈거. ctx 타입을 확장하면서 미들웨어 한 개를 단다.
