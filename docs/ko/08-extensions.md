# 확장 (Extensions)

clip은 manifest 기반 확장 시스템을 지원합니다. 새로운 target type 추가, `clip add` 파싱 통합, 헤더 주입, 호출 로깅 등을 clip 자체를 수정하지 않고 구현할 수 있습니다.

standalone 바이너리(`clip`)에도 TypeScript transpiler가 내장되어 있으므로, bun 별도 설치 없이 `.ts` 확장 파일을 바로 사용할 수 있습니다.

---

## 구조

```
~/.clip/extensions/
  extensions.yml        ← 확장 manifest (등록 목록)
  sql/
    index.ts            ← 확장 구현 파일
  audit/
    index.ts
```

`extensions.yml`에 등록된 확장만 로드됩니다.

---

## 빠른 시작 — hook extension

헤더 주입이나 로깅처럼 기존 target type에 동작을 추가하는 가장 단순한 형태입니다.

**1. 확장 파일 작성**

```ts
// ~/.clip/extensions/audit/index.ts
export const extension = {
  name: "my:audit",
  init(api) {
    api.registerHook("toolcall", (ctx) => {
      api.logger.info(`→ ${ctx.targetName} ${ctx.subcommand} ${ctx.args.join(" ")}`);
    });
  },
};
```

**2. manifest에 등록**

```yaml
# ~/.clip/extensions/extensions.yml
extensions:
  - name: my-audit
    path: /Users/me/.clip/extensions/audit
    entry: index.ts
    contributes:
      hooks: ["toolcall"]   # Phase 1에서 eager init (hooks가 있으면 항상 로드)
```

**3. 실행**

```sh
clip gh pr list
# stderr: [clip] → gh pr list
```

---

## 새 target type 등록

새 target type을 추가하면 `clip add`, `clip list`, 실행(`clip <name> <tool>`)이 모두 자동으로 통합됩니다.

### 최소 예시 — SQLite

```ts
// ~/.clip/extensions/sqlite/index.ts
import { z } from "zod";

const schema = z.object({
  file: z.string(),
  readOnly: z.boolean().default(false),
});

export const extension = {
  name: "user:sqlite",
  init(api) {
    // 1. schema + executor 등록
    api.registerTargetType({
      type: "sqlite",
      schema,
      async executor(target, ctx) {
        const sql = ctx.args.join(" ");
        const flags = target.readOnly ? ["--readonly"] : [];
        const proc = Bun.spawn(["sqlite3", ...flags, target.file, sql]);
        const stdout = await new Response(proc.stdout).text();
        const stderr = await new Response(proc.stderr).text();
        return { exitCode: await proc.exited, stdout, stderr };
      },
    });

    // 2. CLI-layer 계약 등록
    api.registerContribution({
      type: "sqlite",
      dispatchPriority: 35,         // clip add 시 type 판별 우선순위 (낮을수록 먼저)

      argSpec: {
        booleanFlags: ["sqlite"],   // --sqlite → 다음 토큰을 값으로 소비하지 않음
        valueFlags: ["file"],       // --file <path> → 다음 토큰이 값
        identifyFlags: ["sqlite"],  // --sqlite 있으면 이 type이 add 처리
      },

      displayHint: { headerColor: "34" },  // clip list 헤더 색상 (ANSI 코드)

      urlHeuristic: (url) => url.endsWith(".db") || url.endsWith(".sqlite"),

      addHandler: async ({ name, positionals, flags, allow, deny }) => {
        const file = flags["file"] ?? positionals[0];
        if (!file) throw new Error("Usage: clip add <name> <file.db> --sqlite");
        await api.addTarget(name, "sqlite", { file });
        console.log(`Added SQLite target "${name}" → ${file}`);
      },

      listRenderer: async (name, target, opts) => {
        const nm = opts.color("34", name.padEnd(16));
        return `  ${nm} ${target.file}`;
      },
    });
  },
};
```

**manifest 등록**

```yaml
# ~/.clip/extensions/extensions.yml
extensions:
  - name: user-sqlite
    path: /Users/me/.clip/extensions/sqlite
    entry: index.ts
    contributes:
      targetTypes: [sqlite]    # 이 type이 argv에 나타날 때만 lazy init
```

**사용**

```sh
clip add mydb ~/data/app.db --sqlite
# 또는: clip add mydb ~/data/app.db     (urlHeuristic이 .db 감지)

clip mydb query "SELECT * FROM users LIMIT 5"
clip list
# ── sqlite ──
#   mydb             ~/data/app.db
```

### argSpec 상세

| 필드 | 역할 |
|---|---|
| `booleanFlags` | `--flag` 뒤 다음 토큰을 값으로 소비하지 않음. 예: `--sqlite`, `--plaintext` |
| `valueFlags` | `--flag <value>` 형태. 예: `--file /path` |
| `identifyFlags` | 이 flag 중 하나라도 있으면 `clip add` 가 이 type으로 dispatch |

`dispatchPriority`가 낮을수록 먼저 평가됩니다. 같은 priority면 type 이름 알파벳 순.

### manifest object 형태로 argSpec override

manifest에서 기존 type의 argSpec/displayHint를 덮어쓸 수 있습니다.

```yaml
extensions:
  - name: my-sqlite-wrapper
    path: /Users/me/.clip/extensions/sqlite
    entry: index.ts
    contributes:
      targetTypes:
        - name: sqlite
          argSpec:
            booleanFlags: ["sqlite", "wal"]   # --wal flag 추가
          displayHint:
            headerColor: "36"
          dispatchPriority: 25
```

---

## 라이프사이클 훅

기존 target type의 동작을 수정할 때 씁니다.

| 단계 | 시점 | 반환 가능 |
|------|------|-----------|
| `toolcall` | alias 확장 후, ACL 검사 전 | `void` (관찰 전용) |
| `beforeExecute` | ACL 검사 후, executor 실행 전 | headers/args/subcommand 수정, 또는 단락 |
| `afterExecute` | executor 반환 후 | result 부분 머지 |

```ts
// 헤더 주입
api.registerHook("beforeExecute", async (ctx) => {
  if (ctx.targetType !== "api") return;
  const token = await fetchToken(api.env["TOKEN_URL"]!);
  return { headers: { Authorization: `Bearer ${token}` } };
});

// type / target 필터
api.registerHook("beforeExecute", injectAuth, {
  match: { type: ["api", "graphql"], target: [/^prod-/] },
});

// 단락 처리
api.registerHook("beforeExecute", (ctx) => {
  if (ctx.dryRun) {
    return { shortCircuit: { exitCode: 0, stdout: "[dry-run] 건너뜀", stderr: "" } };
  }
});

// 결과 재작성
api.registerHook("afterExecute", (ctx) => {
  if (!ctx.result) return;
  return { result: { stdout: ctx.result.stdout.replace(/secret=\S+/g, "secret=***") } };
});
```

hooks를 사용하는 확장은 manifest에 `hooks: [...]`를 선언해야 항상 eager init됩니다.

---

## 에러 핸들러

```ts
api.registerErrorHandler(async (ctx) => {
  if (ctx.aclDenied) return;
  await reportToSlack(`clip 에러 in ${ctx.targetName}: ${ctx.error}`);
});
```

---

## clip ext 커맨드

```sh
clip ext list              # 등록된 전체 확장 표시 (builtin + user, disabled 포함)
clip ext enable <name>     # manifest의 enabled: true로 변경
clip ext disable <name>    # manifest의 enabled: false로 변경
```

```
NAME              KIND     STATUS    CONTRIBUTES
────────────────  ───────  ────────  ──────────────────
protocol-cli      builtin  enabled   types=[cli]
protocol-mcp      builtin  enabled   types=[mcp]
user-sqlite       user     enabled   types=[sqlite]
my-audit          user     disabled  hooks=[toolcall]
```

---

## 라이프사이클 (2-phase)

```
Phase 1 (시작 시): extensions.yml 읽기 → contributes 인덱싱 (import 없음)
Phase 2 (요청 시): argv 매칭 → 필요한 확장만 import + init

hooks 선언 확장 → 항상 Phase 2 (eager)
targetTypes 전용  → 해당 type의 target이 사용될 때만 Phase 2 (lazy)
```

이후 실행 흐름:

```
init()  →  [toolcall]  →  [beforeExecute]  →  executor  →  [afterExecute]  →  result
                                                                   ↓
                                                      [throw 시 errorHandler]
dispose()  ←  SIGINT / beforeExit
```

---

## 비활성화

```sh
CLIP_NO_EXTENSIONS=1 clip gh pr list   # user extension 전체 skip
```

builtin target type (mcp, cli, api 등)은 계속 로드됩니다.

---

## TypeScript 타입

확장 파일에서 타입 힌트를 사용하려면 clip 저장소를 로컬에 받아 경로로 참조합니다.

```ts
import type { ClipExtension, AddArgs, ListOpts, ArgSpec } from "/path/to/clip/packages/core/src/index.ts";
```

타입 없이도 동작에는 문제없습니다. 간단한 확장은 타입 선언 없이 작성해도 됩니다.

```ts
export const extension = {
  name: "my:hook",
  init(api) {
    api.registerHook("toolcall", (ctx) => {
      console.error(ctx.targetName);
    });
  },
};
```
