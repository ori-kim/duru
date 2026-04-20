# clip

<img src="assets/icon.png" alt="clip icon" width="120" />

MCP 서버와 CLI 도구를 위한 통합 CLI 프록시 게이트웨이 — ACL 규칙 적용, OAuth 인증, AI 에이전트 통합을 하나의 커맨드로.

## 목차

- [주요 기능](#주요-기능)
- [설치](#설치)
- [빠른 시작](#빠른-시작)
- [커맨드](#커맨드)
- [문서](#문서)
- [개발](#개발)

## 주요 기능

- **통합 프록시** — CLI 도구, MCP 서버, REST/GraphQL/gRPC API를 단일 게이트웨이로 관리
- **ACL 적용** — 트리 기반 규칙으로 대상별 서브커맨드 허용/차단
- **OAuth 2.1 PKCE** — MCP 서버 인증을 위한 안전한 토큰 관리
- **에이전트 통합** — Claude Code 스킬로 설치하여 AI 에이전트 워크플로우에서 활용
- **JSON/pipe 출력** — 스크립트와 에이전트 파이프라인을 위한 머신 친화적 모드
- **Dry run** — 실제 실행 없이 나가는 curl/명령어를 미리 확인

## 설치

```sh
curl -fsSL https://raw.githubusercontent.com/ori-kim/cli-proxy/main/install.sh | sh
```

기본 설치 경로는 `~/.local/bin/clip`. `CLIP_INSTALL_DIR` 환경변수로 변경 가능.

**수동 설치:** [최신 릴리즈](https://github.com/ori-kim/cli-proxy/releases/latest) · macOS 전용 (darwin-arm64, darwin-x64)

PATH 추가:

```sh
export PATH="$PATH:$HOME/.local/bin"
```

**Native bind** — `clip` 접두사 없이 원본 명령어 그대로 사용:

```sh
clip bind gh
export PATH="$HOME/.clip/bin:$PATH"   # 다른 항목보다 앞에 추가
gh pr list   # clip을 통해 라우팅됨
```

**Agents 스킬 설치:**

```sh
npx skills add ori-kim/cli-proxy
```

[skills.sh](https://skills.sh) — 깃허브 레포 기반 스킬 레지스트리를 통해 설치.

**Zsh 자동완성:**

```sh
eval "$(clip completion zsh)"
```

## 빠른 시작

```sh
# CLI 도구
clip add gh gh --deny delete
clip gh pr list

# HTTP MCP 서버 (OAuth 포함)
clip add notion https://mcp.notion.com/mcp
clip login notion
clip notion search --query "..."

# OpenAPI REST
clip add petstore https://petstore3.swagger.io/api/v3/openapi.json
clip petstore getPetById --petId 1

# gRPC
clip add my-api localhost:50051 --grpc ./api.proto
clip my-api UserService.GetUser --id 123

# GraphQL
clip add gql https://api.example.com/graphql --graphql
clip gql query --query '{ users { id name } }'
```

## 커맨드

| 커맨드 | 설명 |
|--------|------|
| `clip add <name> <cmd>` | CLI 대상 등록 |
| `clip add <name> <https://...mcp>` | HTTP MCP 등록 |
| `clip add <name> --sse <url>` | SSE MCP 등록 (legacy) |
| `clip add <name> --stdio <cmd> [args]` | STDIO MCP 등록 |
| `clip add <name> <https://.../openapi.json>` | OpenAPI REST 등록 |
| `clip add <name> <host:port> --grpc [proto]` | gRPC 등록 |
| `clip add <name> <https://.../graphql> --graphql` | GraphQL 등록 |
| `clip add <name> --script` | 스크립트 대상 등록 |
| `clip remove <name>` | 대상 삭제 |
| `clip list` | 전체 대상 목록 |
| `clip login / logout <target>` | OAuth 인증 |
| `clip refresh <target>` | 스펙/스키마 재fetch |
| `clip <target> tools` | 도구·오퍼레이션 목록 |
| `clip <target> describe <op>` | 메서드/타입 상세 확인 |
| `clip <target> types` | 전체 타입 목록 (gRPC/GraphQL) |
| `clip add <name> ... --global` | 글로벌에 등록 (활성 워크스페이스 무시) |
| `clip profile add/use/list/remove/unset` | profile 관리 |
| `clip <target>@<profile> <args>` | 1회성 profile override |
| `clip bind / unbind <target>` | 네이티브 명령어 심 |
| `clip binds` | 바인드된 대상 목록 |
| `clip workspace new <name>` | 워크스페이스 생성 |
| `clip workspace use <name> \| -` | 워크스페이스 전환 (또는 해제) |
| `clip workspace list` | 워크스페이스 목록 |
| `clip workspace remove <name>` | 워크스페이스 삭제 |
| `npx skills add ori-kim/cli-proxy` | skills.sh로 에이전트 스킬 설치 |
| `clip completion zsh` | zsh 자동완성 스크립트 출력 |

**글로벌 플래그:** `--json`, `--pipe`, `--dry-run`, `--help`, `--version`

플래그는 명령어 어디에든 붙일 수 있습니다: `clip gh pr list --json`, `clip petstore getPetById --petId 1 --dry-run`

## 문서

- [Target 개요](docs/ko/01-targets.md) — target 종류, profile, ACL, 글로벌 플래그
- [CLI target](docs/ko/02-cli.md) — ACL로 감싼 로컬 CLI 도구, bind, dry run
- [MCP target](docs/ko/03-mcp.md) — HTTP/SSE/STDIO MCP 서버, OAuth
- [API target](docs/ko/04-api.md) — OpenAPI 기반 REST, 파라미터 매핑, 인증
- [gRPC target](docs/ko/05-grpc.md) — protobuf 서비스, 스키마 갱신, dry run
- [GraphQL target](docs/ko/06-graphql.md) — introspection, 쿼리, mutation, 인증
- [Aliases & Scripts](docs/ko/07-aliases.md) — 단축 매크로와 스크립트 번들
- [워크스페이스](docs/ko/09-workspaces.md) — 프로젝트별 target 격리

## 개발

[Bun](https://bun.sh) ≥ 1.1 필요.

```sh
bun install
bun run src/clip.ts --help
bun run build   # → dist/
bun test
```

## 라이선스

MIT
