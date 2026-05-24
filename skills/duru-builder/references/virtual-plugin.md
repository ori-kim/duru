# 버추얼 플러그인

사용자가 설치·제거할 수 있는 동적 플러그인. 정적 플러그인과 별개 시스템이 아니라 **`createPlugin` 위에 얹은 매니페스트 로더**다.

코어: [packages/virtual-plugins/src/virtual-plugin.ts](../../../packages/virtual-plugins/src/virtual-plugin.ts), [installer.ts](../../../packages/virtual-plugins/src/installer.ts), [manifest.ts](../../../packages/virtual-plugins/src/manifest.ts).

## 1. 정의

```ts
import { virtualPlugin } from "@duru/virtual-plugins";

export default virtualPlugin(async (cli) => {
  cli.option("--debug", "...");
  cli.use(async (ctx, next) => { ... });
  cli.command("hello").action((ctx) => ctx.exit(0, { hi: 1 }));
});
```

엄격 규칙 (`installer.ts:60-64` 참고):

- **반드시 `default export`**. 로더가 `mod.default`만 본다.
- `cli` 인자는 정적 플러그인의 `api.cli`와 같은 객체. `use/command/subCommand` 전부 가능.
- async 가능. 부팅 시 file-store 초기화 같은 비동기 작업 OK.

## 2. 정적 플러그인과의 관계

```ts
// installer.ts:71-73
export function virtualPlugins(options, argv): CliPlugin {
  return createPlugin(async (api) => {
    await installVirtualPlugins(api.cli, options, argv);
  });
}
```

즉 `cli.use(virtualPlugins(...))`는 다른 `cli.use(...)`와 같은 경로다. 별도 확장 시스템이 아니라 **부팅 시점에 매니페스트를 읽어 다른 플러그인을 부르는 정적 플러그인**.

이 일관성을 깨지 마라 — 버추얼 플러그인이 직접 `createCli`를 부르거나 다른 cli 인스턴스를 합치는 코드를 만들지 말 것.

## 3. 매니페스트 (`plugins.yml`)

위치: `${DURU_HOME}/plugins/plugins.yml`

```yaml
defaults:
  enabled: true
plugins:
  - name: skills
    path: ./skills
    entry: src/index.ts
    order: 100
    description: Manage agent skills
    contributes:
      commands: [skills]
      eager: false
  - name: context-mode
    path: ./context-mode
    entry: src/index.ts
    contributes:
      commands: [context, ctx]
```

필드:

- `name` — 식별자 (유일)
- `path` — 매니페스트 기준 상대 또는 절대 경로
- `entry` — `path` 안의 진입 파일
- `enabled` — false면 스킵
- `order` — 낮을수록 먼저 init (기본 1000)
- `contributes.commands` — 이 플러그인이 등록하는 top-level verb
- `contributes.eager` — true면 verb 매칭 없어도 항상 init

## 4. 지연 로드 규칙 (`shouldInit`)

[installer.ts:36-43](../../../packages/virtual-plugins/src/installer.ts):

```ts
function shouldInit(plugin, argv) {
  if (!argv) return true;
  if (plugin.contributes.eager) return true;
  const verb = extractVerb(argv);
  if (!verb) return argv.length === 0 || argv.includes("--help");
  if (METADATA_VERBS.has(verb)) return true;       // help, plugin
  return (plugin.contributes.commands ?? []).includes(verb);
}
```

핵심: argv의 첫 positional(=verb)을 뽑아 `contributes.commands`에 있을 때만 로드. 다음 경우는 강제 로드:

- argv 없음 (프로그래매틱 호출)
- `--help` / `-h` 단독
- verb가 `help` 또는 `plugin`
- `contributes.eager: true`

이 메커니즘 덕에 비매칭 시 import 비용이 0이다. 그래서 `eager: true`는 정말 항상 켜져야 할 때만.

## 5. 매니페스트 갱신

```ts
import { upsertPlugin } from "@duru/virtual-plugins";

await upsertPlugin(
  { home: process.env.DURU_HOME },
  { name: "my-plugin", path: "./my-plugin", entry: "src/index.ts", contributes: { commands: ["my"] } },
);
```

동일 `name`이 있으면 덮어쓴다. 보통 `duru plugin add`가 이걸 호출.

## 6. 처방

- ✅ `export default virtualPlugin(async (cli) => { ... })` 한 줄로 시작
- ✅ install 내부에서 외부 의존(file-store, 외부 클라이언트) 초기화하고 클로저로 캡처
- ✅ 그 플러그인이 등록하는 top-level verb 전부를 `contributes.commands`에 기재
- ✅ 비매칭 시 부팅 비용 0이 보장됨 — eager는 정말 필요할 때만
- ✅ 매니페스트 갱신은 `upsertPlugin` 사용. 직접 yaml을 만지지 말 것
- ❌ named export로 virtual plugin 노출 — 로더가 default만 본다
- ❌ 버추얼 플러그인 안에서 `createCli` 호출
- ❌ `contributes.commands`에 verb 누락 → "명령을 만들었는데 안 먹어요" 증상
- ❌ 다른 버추얼 플러그인 import — 의존하지 말 것. 각자 독립

## 7. 안티패턴

```ts
// ❌ named export
export const myPlugin = virtualPlugin(async (cli) => { ... });

// ❌ 함수만 export
export default async function (cli) { ... };

// ❌ install 안에서 다른 cli 만들기
export default virtualPlugin(async (cli) => {
  const sub = createCli({ name: "sub" });   // ❌
  ...
});

// ✅ 단일 export default + virtualPlugin 래퍼
export default virtualPlugin(async (cli) => {
  const home = createDuruFileHome({ env: process.env });
  const store = createMyStore(home.scope("my"));
  cli.command("...").action(...);
});
```

## 8. 디스크 레이아웃 예시

```
$DURU_HOME/
└── plugins/
    ├── plugins.yml
    ├── skills/
    │   ├── package.json
    │   └── src/index.ts          # export default virtualPlugin(...)
    └── context-mode/
        └── src/index.ts
```

이 구조는 모노레포의 `plugins/`와 별개 — 모노레포는 개발 트리, 런타임은 `DURU_HOME/plugins/`를 본다.
