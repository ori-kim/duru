# 서브커맨드 (`createRouter` + `cli.subCommand`)

여러 커맨드를 한 그룹으로 묶어 마운트한다. `createRouter()`로 격리된 라우터를 만들고 `cli.subCommand(name, router)`로 마운트.

## 1. 기본 형태

```ts
import { createRouter } from "@duru/cli-kit";

const skills = createRouter();
skills.command("list").action(...);
skills.command("show <name>").action(...);
skills.command("add <path>").action(...);

cli.subCommand("skills", skills);
```

사용자: `myapp skills list`, `myapp skills show foo`.

## 2. Router는 작은 Cli다

`createRouter()`가 리턴하는 객체는 `cli`와 거의 같은 빌더 API를 갖는다 — `command`, `option`, `use`. 차이점:

- `run`이 없다 (cli에 마운트돼야 실행됨)
- 자신의 미들웨어는 그 라우터 안의 커맨드에만 적용

## 3. 빈 패턴으로 그룹 기본 동작

```ts
const skills = createRouter();

// `myapp skills` 만 쳤을 때
skills.command().group("Skills")
  .meta({ description: "List available skills (default)" })
  .action(async (ctx) => ctx.exit(0, await store.list()));

skills.command("list").action(...);
skills.command("show <name>").action(...);
```

[plugins/skills/src/index.ts:31](../../../plugins/skills/src/index.ts) 패턴. 그룹 진입 시 친절한 기본 동작 제공.

## 4. 라우터 단위 미들웨어

```ts
const admin = createRouter();
admin.use(async (ctx, next) => {
  await ensureAdmin(ctx);
  return next();
});

admin.command("users").action(...);
admin.command("revoke <id>").action(...);

cli.subCommand("admin", admin);
```

`admin`의 모든 커맨드에 자동으로 인증 미들웨어. 글로벌로 빼지 마라 — 다른 커맨드는 admin 권한이 필요 없다.

## 5. 라우터 단위 옵션

```ts
const skills = createRouter();
skills.option("--scope <scope>", "Skills scope (user|workspace)");

skills.command("list").action((ctx) => {
  const scope = (ctx.options as { scope?: string }).scope ?? "user";
  ...
});
```

그 그룹 모든 커맨드에서 `--scope`를 쓸 수 있게 됨.

## 6. 처방

- ✅ 한 그룹 = 한 명사 (`skills`, `gateway`, `plugin`). 동사로 시작하는 그룹 이름은 비추 (`run-*` 같은 거)
- ✅ 그룹 안에서 동사 일관성 (`list/show/add/delete`)
- ✅ 그룹 진입(`myapp skills`)도 빈 패턴 커맨드로 친절히 처리
- ✅ 그룹 한정 옵션·미들웨어는 라우터에 두고 글로벌로 새지 않게
- ❌ 라우터를 또 라우터에 마운트 (nested subCommand) — 깊이 한 단계로 유지. 정말 필요하면 별도 verb로
- ❌ 그룹 이름을 동사로 (`run-skills` 같은) — `skills run`처럼 그룹 = 명사

## 7. 마운트 순서

`cli.subCommand`는 호출 시점에 라우터 정의가 끝나 있어야 한다:

```ts
// ❌ 비어있는 라우터를 먼저 마운트하면 이후 추가가 일부 메서드에 반영 안 될 수 있음
cli.subCommand("skills", skills);
skills.command("list").action(...);

// ✅ 정의를 다 끝낸 뒤 마운트
const skills = createRouter();
skills.command("list").action(...);
skills.command("show <name>").action(...);
cli.subCommand("skills", skills);
```

## 8. 마운트와 help

`cli.subCommand`로 마운트된 라우터의 커맨드는 `cli.use(help())` 호출 시점에 모두 알려져 있어야 `myapp --help`에 정확히 표시된다. 그래서 `help()`는 마지막 근처에 등록하는 게 표준 ([apps/cli/src/app.ts:39](../../../apps/cli/src/app.ts)).
