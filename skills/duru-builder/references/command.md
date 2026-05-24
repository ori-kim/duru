# 커맨드

`cli.command(pattern)` 또는 `router.command(pattern)`이 리턴하는 `CommandBuilder`로 정의한다. action은 미들웨어 체인의 종점이다.

## 1. 패턴 문법 — path 파라미터 전용

```ts
cli.command("hello")                      // 정확 매칭: "hello"
cli.command("hello <name>")               // 필수 path param: "hello foo"
cli.command("hello [name]")               // 선택 path param: "hello" or "hello foo"
cli.command("hello [...rest]")            // 가변 (배열로 수신)
cli.command()                             // 빈 패턴: 그룹의 기본 동작 (subcommand 그룹에서 유용)
```

**원칙**:

- 패턴은 **path 파라미터만**. 옵션은 `.option()`으로 (`<name>`, `[name]`, `[...rest]`이 전부).
- `[...rest]`는 패턴의 **마지막 위치만**.
- 필수와 선택을 섞을 때 필수가 앞에 (`<a> [b]` OK, `[a] <b>` 금지).

## 2. 명명 규칙

- **커맨드 이름**: kebab-case 단어 1개 (`list`, `show`, `add`, `update`, `delete`). 동사 우선.
- **path 파라미터 이름**: kebab-case 또는 단어 1개 (`name`, `path`, `user-id`).
- 같은 서브커맨드 그룹 안에서 동사 일관성 유지 — `get/set` 또는 `add/remove` 혹은 `create/delete` 중 하나로 통일.

| 좋음 | 나쁨 |
|------|------|
| `cli.command("list")` | `cli.command("listAll")` |
| `cli.command("show <name>")` | `cli.command("show-skill <name>")` |
| `cli.command("import [name]")` | `cli.command("importFromAgent [name]")` |

## 3. 빌더 체인

[plugins/skills/src/index.ts:38-47](../../../plugins/skills/src/index.ts) 표준 형태:

```ts
cli.command("list")
  .group("Skills")                         // help에서 묶임
  .meta({ description: "List skills" })
  .option("--tag <tag>", "Filter by tag")
  .action(async (ctx) => {
    return ctx.exit(0, await store.list());
  });
```

| 메서드 | 역할 |
|--------|------|
| `.group(name)` | help 그룹화 |
| `.meta({ description })` | 설명문 (help 표시) |
| `.option(spec, desc?)` | 이 커맨드만의 옵션 |
| `.use(input(...))` | input feature 부착 (`@duru/input-validation` 사용 시) |
| `.alias(pattern)` / `.aliases(...patterns)` | 별칭 |
| `.action(handler)` | 종점 핸들러 |

## 4. action의 책임은 좁다

```ts
.action(async (ctx) => {
  const result = await doWork(ctx.params, ctx.options);
  return ctx.exit(0, result);
});
```

action이 하는 일:

1. `ctx.params` / `ctx.options` / `ctx.values`로 입력 모으기
2. 작업 수행
3. `ctx.exit(code, payload)` 리턴

action이 **하지 않아야** 하는 일:

- 로깅·감사·인증·재시도 → 미들웨어로
- 결과 가공·렌더링 분기 → `adaptResult` 또는 렌더러로
- 다른 커맨드 호출 → 라이브러리 함수로 추출해 둘 다 호출

## 5. ctx.exit

```ts
return ctx.exit(0, payload);          // 정상
return ctx.exit(1, { error: ... });   // 실패
return ctx.exit(0, payload, true);    // JSON 강제 (텍스트 렌더러로 표현 어려운 raw 데이터)
```

exit code 관례:

- `0` — 성공
- `1` — 사용자/환경 오류 (찾을 수 없음, 도구 미설치)
- `2` — 입력 검증 실패

## 6. 사람용 출력과 구조화 출력 동시 반환

```ts
.action(async (ctx) => {
  const records = await store.list();
  const lines = records.map((r) => `${r.name}  ${r.description}`).join("\n");
  process.stdout.write(lines + "\n");      // 사람용
  return ctx.exit(0, records);             // 구조화 (--json 시 사용)
});
```

이 패턴이 표준 ([plugins/skills/src/index.ts:31-36](../../../plugins/skills/src/index.ts)). `process.stdout.write`로 친근한 라인을 흘리고, `ctx.exit`로 동일 데이터를 구조화해 반환 — `--json` 시 렌더러가 자동 분기.

## 7. 라우트 미들웨어

```ts
cli.command("upload <file>")
  .use(async (ctx, next) => {
    await ensureLoggedIn();
    return next();
  })
  .action(...);
```

라우트 미들웨어는 그 커맨드에서만 실행된다. 인증·잠금·재시도 같은 부수효과는 가능한 한 라우트로 좁혀라.

## 8. CommandType 구분 (`CommandConfig`)

커맨드는 내부적으로 다음 필드를 갖는다:

- `pattern` — 컴파일된 path 매칭 규칙
- `metadata` — description, aliases, examples
- `options` — 커맨드 옵션
- `middleware` — 라우트 미들웨어
- `action` — 종점 핸들러
- `presenters` — 렌더러별 후처리 (희소)

`action`이 없는 커맨드도 가능 (그룹의 placeholder), 단 일반적으로 action을 둔다.

## 9. 처방

- ✅ 커맨드 하나 = 작업 하나. 동사로 시작
- ✅ 패턴은 path만, 옵션은 `.option`만
- ✅ 사람용 + 구조화 동시 반환
- ✅ 부수효과는 라우트 미들웨어 또는 글로벌 미들웨어로 분리
- ❌ action 안에서 다른 커맨드를 트리거 — 라이브러리 함수로 추출
- ❌ 패턴 안에 옵션·플래그 표기 시도
- ❌ 같은 그룹 안에서 명명 일관성 깨기 (`add` + `remove` + `delete-it` 섞기)
