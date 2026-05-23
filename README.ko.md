# duru

<img src="assets/icon.png" alt="duru icon" width="120" />

> **프리릴리즈:** duru는 아직 상용 단계가 아닙니다. 버전 간 API나 설정 포맷이 예고 없이 변경될 수 있습니다.

CLI 도구, MCP 서버, API, 스킬, 에이전트 워크플로우를 하나의 커맨드 표면으로 두루 연결하는 프레임워크 서비스.

## 목차

- [주요 기능](#주요-기능)
- [설치](#설치)
- [빠른 시작](#빠른-시작)
- [커맨드](#커맨드)
- [문서](#문서)
- [개발](#개발)

## 주요 기능

- **통합 프레임워크 표면** — CLI 도구, MCP 서버, REST/GraphQL/gRPC API, 워크플로우 helper를 하나의 런타임으로 관리
- **ACL 적용** — 트리 기반 규칙으로 대상별 서브커맨드 허용/차단
- **OAuth 2.1 PKCE** — MCP 서버 인증을 위한 안전한 토큰 관리
- **에이전트 통합** — Claude Code 스킬로 설치하여 AI 에이전트 워크플로우에서 활용
- **JSON/pipe 출력** — 스크립트와 에이전트 파이프라인을 위한 머신 친화적 모드
- **Dry run** — 실제 실행 없이 나가는 curl/명령어를 미리 확인

## 설치

**사전 빌드 바이너리** (Apple Silicon 전용, 별도 설치 불필요):

```sh
curl -fsSL https://raw.githubusercontent.com/ori-kim/duru/main/install.sh | sh
```

기본 설치 경로: `~/.local/bin/duru`. `DURU_INSTALL_DIR` 환경변수로 변경 가능.

**Bun으로 설치** ([Bun](https://bun.sh) ≥ 1.0 필요):

```sh
bun install -g github:ori-kim/duru
```

PATH 추가:

```sh
export PATH="$PATH:$HOME/.local/bin"
```

**수동 설치:** [최신 릴리즈](https://github.com/ori-kim/duru/releases/latest) · Apple Silicon (darwin-arm64)

**Native bind** — `duru` 접두사 없이 원본 명령어 그대로 사용:

```sh
duru gateway add gh gh
duru gateway bind gh gh
export PATH="$HOME/.duru/bin:$PATH"   # 다른 항목보다 앞에 추가
gh pr list   # duru를 통해 라우팅됨
```

**Agents 스킬 설치:**

```sh
npx skills add ori-kim/duru
```

[skills.sh](https://skills.sh) — 깃허브 레포 기반 스킬 레지스트리를 통해 설치.

**Zsh 자동완성:**

```sh
eval "$(duru completion zsh)"
```

**업데이트:**

```sh
duru update --check
duru update --yes
```

## 빠른 시작

```sh
# CLI 도구
duru gateway add gh gh --deny delete
duru gh pr list

# HTTP MCP 서버 (OAuth 포함)
duru gateway add notion https://mcp.notion.com/mcp
duru gateway login notion
duru notion search --query "..."

# OpenAPI REST
duru gateway add petstore https://petstore3.swagger.io/api/v3/openapi.json
duru petstore getPetById --petId 1

# gRPC
duru gateway add my-api localhost:50051 --grpc ./api.proto
duru my-api UserService.GetUser --id 123

# GraphQL
duru gateway add gql https://api.example.com/graphql --graphql
duru gql query --query '{ users { id name } }'
```

## 커맨드

| 커맨드 | 설명 |
|--------|------|
| `duru gateway add <name> <cmd>` | CLI 대상 등록 |
| `duru gateway add <name> <https://...mcp>` | HTTP MCP 등록 |
| `duru gateway add <name> --sse <url>` | SSE MCP 등록 (legacy) |
| `duru gateway add <name> --stdio <cmd> [args]` | STDIO MCP 등록 |
| `duru gateway add <name> <https://.../openapi.json>` | OpenAPI REST 등록 |
| `duru gateway add <name> <host:port> --grpc [proto]` | gRPC 등록 |
| `duru gateway add <name> <https://.../graphql> --graphql` | GraphQL 등록 |
| `duru gateway add <name> --script` | 스크립트 대상 등록 |
| `duru gateway remove <name>` | 대상 삭제 |
| `duru gateway list` | 전체 대상 목록 |
| `duru gateway login / logout <target>` | OAuth 인증 |
| `duru gateway refresh <target>` | 스펙/스키마 재fetch |
| `duru update [--check]` | 최신 릴리즈에서 로컬 duru 바이너리 업데이트 |
| `duru <target> tools` | 도구·오퍼레이션 목록 |
| `duru <target> describe <op>` | 메서드/타입 상세 확인 |
| `duru <target> types` | 전체 타입 목록 (gRPC/GraphQL) |
| `duru gateway profile add/use/list/remove/unset` | profile 관리 |
| `duru <target>@<profile> <args>` | 1회성 profile override |
| `duru gateway bind <name> <target> [...args]` | 네이티브 명령어 심 |
| `duru gateway unbind <name>` | 네이티브 명령어 심 제거 |
| `duru gateway binds` | 바인드된 대상 목록 |
| `duru skills add <name>` | 프롬프트 템플릿 스킬 생성 |
| `duru skills list` | 스킬 목록 (설치된 에이전트 표시) |
| `duru skills get <name> [--input k=v ...]` | inputs 치환 후 렌더링 |
| `duru skills install <name> --to <agent>` | 에이전트에 스킬 설치 |
| `duru skills uninstall <name>` | 에이전트에서 스킬 제거 |
| `npx skills add ori-kim/duru` | skills.sh로 에이전트 스킬 설치 |
| `duru completion zsh` | zsh 자동완성 스크립트 출력 |

**글로벌 플래그:** `--json`, `--json-output`, `--pipe`, `--dry-run`, `--help`, `--version`

플래그는 명령어 어디에든 붙일 수 있습니다: `duru gh pr list --json`, `duru petstore getPetById --petId 1 --dry-run`

**Target timeout:** target config의 `timeoutMs`가 가장 우선이고, 없으면 `DURU_TARGET_TIMEOUT_MS`, 없으면 기본 `30000` ms를 사용합니다.

## 문서

- [Target 개요](docs/ko/01-targets.md) — target 종류, profile, ACL, 글로벌 플래그
- [CLI target](docs/ko/02-cli.md) — ACL로 감싼 로컬 CLI 도구, bind, dry run
- [MCP target](docs/ko/03-mcp.md) — HTTP/SSE/STDIO MCP 서버, OAuth
- [API target](docs/ko/04-api.md) — OpenAPI 기반 REST, 파라미터 매핑, 인증
- [gRPC target](docs/ko/05-grpc.md) — protobuf 서비스, 스키마 갱신, dry run
- [GraphQL target](docs/ko/06-graphql.md) — introspection, 쿼리, mutation, 인증
- [Aliases & Scripts](docs/ko/07-aliases.md) — 단축 매크로와 스크립트 번들
- [Extensions](docs/ko/08-extensions.md) — hooks, 신규 target 타입, 에러 핸들러
- [Skills](docs/ko/10-skills.md) — inputs 지원 재사용 프롬프트 템플릿, 에이전트 설치

## 개발

[Bun](https://bun.sh) ≥ 1.1 필요.

```sh
bun install
bun run src/duru.ts --help
bun run build   # → dist/
bun test
```

## 버저닝

duru는 LY Corporation이 제안한 **[HeadVer](https://techblog.lycorp.co.jp/ko/headver-new-versioning-system-for-product-teams)** 버전 체계를 사용합니다.

형식: `Head.YearWeek.Build`

| 필드 | 설정 | 의미 |
|------|------|------|
| `Head` | 수동 | 의미 있는 릴리즈마다 증가. `0` = 프리릴리즈. |
| `YearWeek` | 자동 | ISO 8601 연도 + 주차 (예: `2617` = 2026년 17주차) |
| `Build` | 자동 | Git commit count — 정확한 바이너리를 식별 |

## 라이선스

MIT
