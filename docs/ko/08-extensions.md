# 확장 (Extensions)

clip은 manifest 기반 확장 시스템을 지원합니다. 새로운 target type 추가, `clip add` 파싱 통합, 헤더 주입, 호출 로깅 등을 clip 자체를 수정하지 않고 구현할 수 있습니다.

standalone 바이너리(`clip`)에도 TypeScript transpiler가 내장되어 있으므로, bun 별도 설치 없이 `.ts` 확장 파일을 바로 사용할 수 있습니다.

---

## 구조

```
$CLIP_HOME/extensions/        ← 기본값: ~/.clip/extensions
  extensions.yml              ← 확장 manifest (등록 목록)
  myext/
    src/
      extension.ts            ← 확장 구현 파일
    tsconfig.json             ← clip ext scaffold가 자동 생성
$CLIP_HOME/types/
  @clip/core/                 ← 타입 선언 파일 (clip ext scaffold / types가 배포)
```

`extensions.yml`에 등록된 확장만 로드됩니다. manifest의 path는 상대경로로 선언할 수 있으며, `CLIP_HOME/extensions/` 기준으로 resolve됩니다.

---

## 빠른 시작 — hook extension

헤더 주입이나 로깅처럼 기존 target type에 동작을 추가하는 가장 단순한 형태입니다.

**1. 확장 파일 작성**

```ts
// ~/.clip/extensions/audit/index.ts
export const extension = {
  name: "my:audit",
  init(api) {
    api.registerHook("subcommand-start", (ctx) => {
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
      hooks: ["subcommand-start"]   # Phase 1에서 eager init (hooks가 있으면 항상 로드)
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
import { addTarget } from "@clip/core";
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
        await addTarget(name, "sqlite", { file });
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

CLI 실행을 관찰하거나 기존 target type의 동작을 수정할 때 씁니다.

| 단계 | 시점 | 반환 가능 |
|------|------|-----------|
| `command-start` | extension 초기화 후, command 실행 전 | `void` |
| `command-end` | command 실행 완료 후 | `void` |
| `subcommand-start` | ACL 검사 후, executor 실행 전 | headers/args/subcommand 수정, 또는 단락 |
| `subcommand-end` | executor 반환 후 | result 부분 머지 |

`subcommand-*` hook은 target 호출(`clip <target> <subcommand>`)과 top-level command(`clip add`, `clip history` 등)에 모두 실행됩니다. context에는 `kind`, `command`, `subcommand`, `subcommandIndex`가 들어 있어 hook이 어느 위치의 subcommand 토큰인지 구분할 수 있습니다.

```ts
// 헤더 주입
api.registerHook("subcommand-start", async (ctx) => {
  if (ctx.targetType !== "api") return;
  const token = await fetchToken(api.env["TOKEN_URL"]!);
  return { headers: { Authorization: `Bearer ${token}` } };
});

// type / target 필터
api.registerHook("subcommand-start", injectAuth, {
  match: { type: ["api", "graphql"], target: [/^prod-/] },
});

// 단락 처리
api.registerHook("subcommand-start", (ctx) => {
  if (ctx.dryRun) {
    return { shortCircuit: { exitCode: 0, stdout: "[dry-run] 건너뜀", stderr: "" } };
  }
});

// 결과 재작성
api.registerHook("subcommand-end", (ctx) => {
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
clip ext install github:owner/repo                 # .clip/extension-index.yaml을 읽고 선택 설치
clip ext install github:owner/repo --all --yes
clip ext install github:owner/repo --select myext --yes
clip ext install github:owner/repo --dir extensions/myext --yes
clip ext install https://github.com/owner/repo/tree/main/extensions/myext --yes
clip ext update <name>      # 기록된 upstream source에서 재설치
clip ext uninstall <name> --yes
clip ext info <name>        # 설치 메타데이터 출력
clip ext scaffold <name>   # 새 확장 스캐폴드 (폴더·진입점·tsconfig·manifest entry 자동 생성)
clip ext types             # @clip/core 타입 파일만 CLIP_HOME/types/에 재배포 (IDE 지원)
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
my-audit          user     disabled  hooks=[subcommand-start]
```

### GitHub에서 설치

repo는 `.clip/extension-index.yaml` installable extension index를 제공할 수 있습니다.

```yaml
extensions:
  - name: myext
    dir: extensions/myext
    description: myext command 추가
```

index에 여러 extension이 있으면 `clip ext install github:owner/repo`가 인터랙티브 checklist 스타일 선택 프롬프트를 엽니다. non-interactive 환경에서는 `--all` 또는 `--select name[,name]`을 넘깁니다.

하위 호환을 위해 `.clip/extensions.yaml`, `.clip/extensions.yml`, `.clip/extensions.json`, `clip/extensions.yaml`, `clip/extensions.yml`, `clip/extensions.json`도 repo-level index 경로로 허용합니다.

각 설치 가능한 upstream 폴더는 extension metadata를 포함해야 합니다. 표준 경로는 `clip/extension.yaml`입니다. `clip/extension.yml`, `clip/extension.json`, legacy `clip-extension.json`도 fallback으로 허용합니다.

```yaml
name: myext
version: 0.1.0
entry: src/extension.ts
contributes:
  commands: [myext]
  targetTypes: []
  hooks: []
runtime:
  dependencies: {}
```

`clip ext install`은 선택한 GitHub 폴더를 `$CLIP_HOME/extensions/<name>/` 운영본으로 복사하고, `runtime.dependencies` 기준으로 runtime `package.json`을 생성합니다. dependency가 있으면 `npm install --omit=dev`를 실행하고, `extensions.yml`에는 `path: <name>` 형태로 등록합니다.

설치 시 `$CLIP_HOME/extensions/<name>/.clip-install.json`에 GitHub source와 resolved commit을 저장합니다. `clip ext update <name>`은 이 기록을 사용해 같은 upstream 폴더에서 재설치합니다.

manifest는 source checkout이 아니라 설치된 운영본을 가리켜야 합니다.

```yaml
extensions:
  - name: myext
    path: myext
    entry: src/extension.ts
    contributes:
      commands: [myext]
      targetTypes: []
      hooks: []
```

---

## Top-level 커맨드

builtin top-level command는 user extension보다 먼저 등록됩니다. 새 커맨드는 `api.commands.register()`로 추가합니다:

```ts
api.commands.register({
  name: "hello",
  description: "print a greeting",
  options: [
    { name: "check", type: "boolean" },
    { name: "version", type: "value", valueName: "tag" },
    { name: "yes", type: "boolean", aliases: ["y"] },
  ],
  async run(ctx) {
    console.log(
      JSON.stringify({
        args: ctx.args,
        options: ctx.options,
        globalOptions: ctx.globalOptions,
      }),
    );
  },
});
```

`clip add` 같은 builtin command를 바꾸려면 명시적인 override API를 사용합니다:

```ts
api.commands.override("add", {
  async run(ctx) {
    console.log(`custom add flow: ${ctx.args.join(" ")}`);
  },
});
```

lazy loader가 해당 verb에서 extension을 import할 수 있도록 manifest에도 command를 선언해야 합니다:

```yaml
contributes:
  commands: [add]
```

`clip update`는 early builtin command입니다. 깨진 로컬 설치를 복구할 수 있도록 user extension과 hook보다 먼저 실행되며 override할 수 없습니다.

---

## Global option

extension은 leading 또는 anywhere-style global option을 등록할 수 있습니다. leading option은 top-level command 앞에서 파싱되고, anywhere option은 target invocation 안에서도 제거되어 global option으로 병합됩니다.

```ts
api.options.registerGlobal({
  name: "trace-id",
  type: "value",
  placement: "leading",
  valueName: "id",
});
```

lazy loader가 command verb를 찾을 때 이 flag를 건너뛸 수 있도록 manifest에도 선언합니다:

```yaml
contributes:
  commands: [hello]
  globalOptions:
    - name: trace-id
      type: value
```

파싱된 값은 command handler, executor, `subcommand-*` hook의 `ctx.globalOptions`에서 확인할 수 있습니다.

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
init()  →  [command-start]  →  [subcommand-start]  →  executor  →  [subcommand-end]  →  [command-end]
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

`clip ext scaffold <name>` 실행 시 (또는 `clip ext types`로 별도 배포) `@clip/core` 타입 선언 파일이 `CLIP_HOME/types/@clip/core/`에 자동 배포됩니다. 생성된 `tsconfig.json`에 `paths` 매핑이 포함되어 있어 VS Code에서 `@clip/core` import가 바로 resolve됩니다.

```sh
clip ext scaffold myext
# 생성:
#   CLIP_HOME/extensions/myext/src/extension.ts
#   CLIP_HOME/extensions/myext/tsconfig.json   ← paths: { "@clip/core/*": [...] }
#   CLIP_HOME/types/@clip/core/                ← 타입 선언 파일
#   extensions.yml entry 자동 추가
```

확장 파일 내에서 `@clip/core`, `zod`, `yaml`은 **virtual module**로 바로 사용할 수 있습니다 — clip 바이너리에 번들되어 있어 별도 설치가 필요 없습니다.

```ts
import { die } from "@clip/core";
import { z } from "zod";
import { parse } from "yaml";
```

타입 없이도 동작에는 문제없습니다. 간단한 확장은 타입 선언 없이 작성해도 됩니다.

```ts
export const extension = {
  name: "my:hook",
  init(api) {
    api.registerHook("subcommand-start", (ctx) => {
      console.error(ctx.targetName);
    });
  },
};
```
