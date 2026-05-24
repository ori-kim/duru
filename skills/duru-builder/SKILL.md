---
name: duru-builder
description: Author duru CLIs and plugins with @duru/cli-kit. Triggers on creating or editing duru-based CLIs, calls to createCli/createRouter/createPlugin/virtualPlugin, the cli.use(...) chain, command/option/middleware/input definitions, anything involving @duru/cli-kit or @duru/virtual-plugins, or "duru로 CLI 만들기/플러그인 작성/명령 추가/확장". Do NOT use for invoking external tools through `duru gateway` — that's the duru-gateway skill.
tags: [duru, cli-kit, plugin, virtual-plugin, middleware]
---

# duru-builder

`@duru/cli-kit`으로 CLI를 **직접 구성**하거나 플러그인을 작성할 때의 처방전.

> 외부 도구를 부르는 게 목적이라면 `duru-gateway` 스킬을 쓴다.

## 메타 원칙 — 먼저 외워라

이 5개를 어기지 않으면 나머지는 자동으로 따라온다.

1. **모든 실행은 미들웨어 체인**. action도 파이프라인의 종점일 뿐이다 ([pipeline.ts:14](../../core/cli/src/middleware/pipeline.ts)). 부수효과·로깅·인증·결과 후처리는 전부 미들웨어로 표현한다.
2. **모든 확장은 `createPlugin` 한 가지 기본형**. `option()`, `context()`, `renderer()`, `adaptResult()`, `virtualPlugin()`은 전부 그 위에 얹힌 슈거 ([plugin/index.ts](../../core/cli/src/plugin/index.ts)). 별도 확장 경로를 신설하지 않는다.
3. **슈거를 만들 거면 미들웨어로 환원되게**. `cli.option`조차 내부에서 `cli.use(optionPlugin(...))`로 환원된다 ([cli/index.ts:94-97](../../core/cli/src/cli/index.ts)). 환원 불가능한 슈거는 만들지 않는다.
4. **action은 결과를 만드는 곳, 미들웨어는 흐름을 다루는 곳**. action 안에서 try/finally로 로그 남기지 말고 미들웨어로 빼라.
5. **패턴은 path 파라미터 전용**. `<name>` / `[name]` / `[...rest]`만 들어간다. 옵션·플래그는 `.option(...)`으로.

## 토픽 → 로드할 reference

| 작업 | 먼저 읽기 |
|------|---------|
| 미들웨어 체인 설계, 부수효과 어디에 둘지 | [references/middleware.md](references/middleware.md) |
| `createCli` 인스턴스 구성, 부팅 순서 | [references/createCli.md](references/createCli.md) |
| `createPlugin`과 슈거(option/context/renderer)로 정적 플러그인 작성 | [references/plugin.md](references/plugin.md) |
| 사용자가 설치/제거하는 동적 플러그인 작성 | [references/virtual-plugin.md](references/virtual-plugin.md) |
| 글로벌 옵션 vs 커맨드 옵션, spec 문법 | [references/option.md](references/option.md) |
| 커맨드 정의, 패턴 문법, 명명 규칙 | [references/command.md](references/command.md) |
| 서브커맨드 그룹 만들기 (`createRouter` + `cli.subCommand`) | [references/subcommand.md](references/subcommand.md) |
| 입력 스키마 검증 (`input` + `@duru/input-validation`) | [references/input.md](references/input.md) |
| 어느 패키지에 뭐가 있는지 | [references/packages-map.md](references/packages-map.md) |

## 빠른 형태 비교

```ts
// 정적 플러그인 — 부팅 시 항상 로드
const myPlugin = createPlugin(async (api) => {
  api.option({ ... });
  api.middleware(async (ctx, next) => { ... });
});

// 버추얼 플러그인 — 매니페스트 기반 지연 로드, default export 필수
export default virtualPlugin(async (cli) => {
  cli.option("--debug", "...");
  cli.use(async (ctx, next) => { ... });
  cli.command("hello").action((ctx) => ctx.exit(0, { hi: 1 }));
});
```

## 가드레일

- 슈거가 부족하다고 느낀다면 미들웨어를 한 번 더 시도해보라. `adaptResult` 한 줄로 끝나는 일이 많다.
- 새 패키지를 만들기 전에 [references/packages-map.md](references/packages-map.md)를 본다 — `file-store`, `auth`, `env`가 이미 있다.
- 버추얼 플러그인은 **반드시 `default export`**. 매니페스트 로더가 `mod.default`만 확인한다 ([installer.ts:60](../../packages/virtual-plugins/src/installer.ts)).
- 사람용 출력은 `process.stdout.write`, 구조화 결과는 `ctx.exit(code, payload)` — 동시에 반환.

## 검증

```bash
bun run apps/cli/src/main.ts --help
bun run apps/cli/src/main.ts <your-command> --help
```
