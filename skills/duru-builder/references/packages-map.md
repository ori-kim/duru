# 패키지 맵

새 기능을 만들기 전에 이 표를 본다. 대부분의 기반 시설은 이미 있다.

## 코어

| 패키지 | 역할 | 핵심 export |
|--------|------|------------|
| [`@duru/cli-kit`](../../../core/cli/src/index.ts) | CLI 프레임워크 본체 | `createCli`, `createRouter`, `createPlugin`, `option`, `context`, `renderer`, 모든 타입 |

## 플러그인 시스템

| 패키지 | 역할 | 핵심 export |
|--------|------|------------|
| [`@duru/virtual-plugins`](../../../packages/virtual-plugins/src/index.ts) | 매니페스트 기반 동적 플러그인 로더 | `virtualPlugin`, `virtualPlugins`, `upsertPlugin`, `loadPluginManifest`, `isVirtualPlugin` |
| [`@duru/plugin-manage`](../../../packages/plugin-manage) | `duru plugin add/remove/list` 커맨드 제공 | `pluginManageCli` (라우터) |

## 기반 시설

| 패키지 | 역할 | 언제 쓰나 |
|--------|------|----------|
| [`@duru/file-store`](../../../packages/file-store) | `DURU_HOME` 하위 파일/디렉토리 접근 추상화 | 플러그인이 영속 상태를 갖고 싶을 때 |
| [`@duru/auth`](../../../packages/auth) | OAuth/토큰 인증 흐름 공통 부품 | 외부 API에 로그인이 필요할 때 |
| [`@duru/env`](../../../packages/env) | `process.env` 검증/병합 + ctx 노출 | 설정값을 ctx로 받고 싶을 때 |
| [`@duru/input-validation`](../../../packages/input-validation) | 입력 스키마 검증 | 패턴이나 옵션의 값 검증 |

## 렌더러

| 패키지 | 역할 | 등록 시점 |
|--------|------|----------|
| [`@duru/renderer-text`](../../../packages/renderer-text) | 사람이 읽을 수 있는 텍스트 출력 (기본) | `cli.use(textRendererPlugin())` |
| [`@duru/renderer-json`](../../../packages/renderer-json) | `--json` 시 구조화 JSON | `cli.use(jsonRendererPlugin())` |
| [`@duru/renderer-clack`](../../../packages/renderer-clack) | clack 기반 인터랙티브 UI 출력 | 대화형 명령에서 |
| [`@duru/clack`](../../../packages/clack) | clack 프롬프트 헬퍼 | confirm/select/text 같은 인터랙티브 위젯 |

## 보조 기능

| 패키지 | 역할 |
|--------|------|
| [`@duru/cli-gateway`](../../../packages/cli-gateway) | 외부 자원 게이트웨이 (`duru gateway`의 엔진) — CLI/API/MCP/gRPC/GraphQL 어댑터 |
| [`@duru/completion-zsh`](../../../packages/completion-zsh) | zsh 자동완성 스크립트 생성 |
| [`@duru/qmd`](../../../packages/qmd) | QMD(벡터 검색) 클라이언트 — `plugins/skills`가 사용 |

## 의사결정 가이드

- **파일 저장이 필요해** → `@duru/file-store`. 새로 만들지 말 것.
- **외부 API에 로그인** → `@duru/auth`. OAuth 흐름 다 들어 있음.
- **사용자가 인터랙티브로 답해야 함** → `@duru/clack` + `renderer-clack`. 직접 `readline` 안 씀.
- **JSON 출력이 필요한가** → `cli.use(jsonRendererPlugin())`는 앱에서 이미 등록됨. `ctx.exit(0, data, true)`만 호출.
- **외부 CLI/API/MCP를 부르고 싶음** → `@duru/cli-gateway`. 이 케이스는 `duru-gateway` 스킬을 본다.

## 모노레포 vs 런타임 위치

- `core/cli/` — 코어 워크스페이스 (`@duru/cli-kit` 본체)
- `packages/*` — 정적 플러그인·라이브러리 (앱이 직접 import)
- `plugins/*` — **개발 중인** 버추얼 플러그인 (런타임은 `DURU_HOME/plugins/`를 본다는 점 주의)
- `apps/cli/` — 최종 바이너리 진입 (`bun run apps/cli/src/main.ts`)
- `skills/*` — 에이전트용 스킬 (지금 이 디렉토리)
