# clip

MCP 서버와 CLI 도구를 위한 통합 CLI 프록시 게이트웨이 — ACL 규칙 적용, OAuth 인증, AI 에이전트 통합을 하나의 커맨드로.

## 주요 기능

- **통합 프록시** — 모든 CLI 도구와 MCP 서버를 단일 게이트웨이로 관리
- **ACL 적용** — 트리 기반 규칙으로 대상별 서브커맨드 허용/차단
- **OAuth 2.1 PKCE** — MCP 서버 인증을 위한 안전한 토큰 관리
- **에이전트 통합** — Claude Code 스킬로 설치하여 AI 에이전트 워크플로우에서 활용
- **JSON/pipe 출력** — 스크립트와 에이전트 파이프라인을 위한 머신 친화적 모드
- **Dry run** — 실제 실행 없이 나가는 curl/명령어를 미리 확인

## 문서

- [Target 개요](docs/ko/targets.md) — target이란, 종류, 공통 config 필드, 글로벌 플래그
- [CLI target](docs/ko/cli.md) — ACL로 감싼 로컬 CLI 도구, bind, dry run
- [MCP target](docs/ko/mcp.md) — HTTP/SSE/STDIO MCP 서버, OAuth, JSON-RPC 동작 방식
- [API target](docs/ko/api.md) — OpenAPI 기반 REST target, 파라미터 매핑, 인증

## 설치

```sh
curl -fsSL https://raw.githubusercontent.com/ori-kim/cli-proxy/main/install.sh | sh
```

기본 설치 경로는 `~/.local/bin/clip`. `CLIP_INSTALL_DIR` 환경변수로 변경 가능.

**수동 설치:** [최신 릴리즈](https://github.com/ori-kim/cli-proxy/releases/latest) · macOS 전용 (darwin-arm64, darwin-x64)

### PATH 설정

`~/.local/bin`이 PATH에 없다면 셸 프로필에 추가하세요:

```sh
export PATH="$PATH:$HOME/.local/bin"
```

### 네이티브 바인드 (선택)

바인드를 사용하면 `clip` 접두사 없이 대상 명령어를 직접 실행할 수 있습니다:

```sh
clip bind gh   # 이제 'gh'가 clip을 통해 라우팅됨
gh pr list     # clip gh pr list 와 동일
```

clip이 명령어를 가로채려면 `~/.clip/bin`을 PATH **앞에** 추가하세요:

```sh
export PATH="$HOME/.clip/bin:$PATH"
```

## Zsh 자동완성

`~/.zshrc`에 추가하세요:

```sh
eval "$(clip completion zsh)"
```

이후 셸을 재시작하거나 `source ~/.zshrc`를 실행하세요.

- `clip <TAB>` — 타입별로 그룹화된 등록 대상 (cli / mcp / api) 및 URL·명령어 표시, built-in은 마지막
- `clip <target> <TAB>` — 도구·오퍼레이션 이름과 설명 (1시간 캐시)
- `clip gh pr <TAB>` — 원본 명령어의 자동완성에 위임

타이핑 중 inline 회색 힌트를 원한다면 [zsh-autosuggestions](https://github.com/zsh-users/zsh-autosuggestions) 설치 후:

```sh
ZSH_AUTOSUGGEST_STRATEGY=(history completion)
```

캐시를 수동으로 초기화하려면:

```sh
rm -f ~/.zcompcache/clip-tools-*
```

## Claude Code 통합

clip을 Claude Code 스킬로 설치하면 AI 에이전트가 등록된 대상을 직접 도구로 사용할 수 있습니다:

```sh
# skills.sh로 설치 (GitHub 레포 직접 지정, 별도 등록 불필요)
npx skills add https://github.com/ori-kim/cli-proxy

# 또는 clip 자체 커맨드로 설치
clip skills add claude-code
```

설치 후 Claude Code는 모든 clip 대상을 도구로 호출할 수 있으며, 호출마다 ACL 규칙이 적용됩니다.

## 빠른 시작

```sh
# CLI 도구 등록
clip add gh gh --deny delete
clip gh pr list

# MCP 서버 등록 및 인증
clip add notion https://mcp.notion.com/mcp
clip login notion
clip notion search --query "..."

# OpenAPI REST API 등록
clip add petstore https://petstore3.swagger.io/api/v3/openapi.json
clip petstore getPetById --petId 1

# gRPC 서버 등록
clip add my-api localhost:50051 --grpc ./api.proto
clip my-api tools
clip my-api UserService.GetUser --id 123

# GraphQL API 등록
clip add gql https://api.example.com/graphql --graphql
clip gql tools
clip gql query --query '{ users { id name } }'


# 대상 관리
clip list
clip remove notion
```

## ACL 규칙

인라인 플래그로 최상위 규칙을 지정합니다:

```sh
clip add gh gh --deny delete
```

트리 기반 규칙은 `~/.clip/target/cli/gh/config.yml`을 직접 편집하세요:

```yaml
command: gh
acl:
  repo:
    allow: [list, view]
  pr:
    deny: [delete]
```

`deny`가 `allow`보다 우선합니다. 규칙은 인수 트리를 따라 왼쪽에서 오른쪽으로 평가됩니다.

## 설정

| 경로 | 용도 |
|------|------|
| `~/.clip/target/{cli,mcp,api,grpc,graphql}/<name>/config.yml` | 대상 설정 및 ACL 규칙 |
| `~/.clip/target/{mcp,api}/<name>/auth.json` | OAuth 토큰 |
| `~/.clip/target/api/<name>/spec.json` | 캐시된 OpenAPI 스펙 |
| `~/.clip/target/grpc/<name>/schema.json` | 캐시된 gRPC proto 스키마 |
| `~/.clip/target/graphql/<name>/schema.json` | 캐시된 GraphQL 스키마 |
| `~/.clip/.env` | 전역 환경변수 (`config.yml`에 치환) |

### 인증 설정

`auth` 필드로 대상별 인증 방식을 지정합니다:

```yaml
# 인증 없음 (기본값)
auth: false

# OAuth 2.1 PKCE — `clip login <target>`으로 인증
auth: oauth

# API 키 — headers로 토큰 전달
auth: apikey
headers:
  Authorization: "Bearer ${API_KEY}"
```

### API target 필드

```yaml
# baseUrl: 실제 요청이 전송되는 주소 (필수)
baseUrl: https://api.example.com

# openapiUrl: OpenAPI 스펙을 가져올 URL (spec.json이 로컬에 있으면 생략 가능)
openapiUrl: https://api.example.com/openapi.json
```

## 커맨드

| 커맨드 | 설명 |
|--------|------|
| `clip add <name> <cmd>` | CLI 대상 등록 |
| `clip add <name> <https://...mcp>` | HTTP MCP 대상 등록 |
| `clip add <name> --sse <https://...sse>` | legacy SSE MCP 대상 등록 |
| `clip add <name> --stdio <cmd> [args]` | STDIO MCP 대상 등록 |
| `clip add <name> <https://.../openapi.json>` | OpenAPI REST 대상 등록 |
| `clip add <name> <host:port> --grpc [proto]` | gRPC 대상 등록 |
| `clip add <name> <https://.../graphql> --graphql` | GraphQL 대상 등록 |
| `clip remove <name>` | 대상 삭제 |
| `clip list` | 전체 대상 목록 및 인증 상태 |
| `clip login <target>` | OAuth 인증 |
| `clip logout <target>` | 저장된 토큰 삭제 |
| `clip refresh <target>` | OpenAPI 스펙 재fetch |
| `clip <target> tools` | 사용 가능한 도구·오퍼레이션 목록 |
| `clip <target> describe <Service.Method>` | gRPC 메서드 시그니처 확인 |
| `clip <target> describe <type>` | GraphQL 타입 정의 확인 |
| `clip <target> types` | gRPC 메시지 타입 또는 GraphQL 타입 목록 |
| `clip bind <target>` | 네이티브 명령어 심 생성 |
| `clip unbind <target>` | 네이티브 명령어 심 삭제 |
| `clip binds` | 현재 바인드된 대상 목록 |
| `clip skills add claude-code` | Claude Code 스킬로 설치 |
| `clip completion zsh` | zsh 자동완성 스크립트 출력 |

**글로벌 플래그:** `--json`, `--pipe`, `--dry-run`, `--help`, `--version`

플래그는 명령어 어디에든 붙일 수 있습니다:

```sh
clip gh pr list --json
clip petstore getPetById --petId 1 --dry-run
clip notion search --query "hello" --json --dry-run
```

## Dry Run

실제 실행 없이 어떤 요청/명령이 나가는지 미리 확인합니다:

```sh
# API target → curl 명령어 출력 (인증 헤더 포함)
clip --dry-run petstore getPetById --petId 1
# curl -X GET 'https://petstore3.swagger.io/api/v3/pet/1' \
#   -H 'Accept: application/json'

# HTTP MCP target → JSON-RPC curl 출력
clip notion search_pages --query "hello" --dry-run
# curl -X POST 'https://mcp.notion.com/mcp' \
#   -H 'Authorization: Bearer eyJ...' \
#   -H 'Content-Type: application/json' \
#   -d '{"jsonrpc":"2.0","id":1,"method":"tools/call",...}'

# SSE MCP target → SSE 연결 + POST 두 단계 출력
clip myserver search --query "hello" --dry-run

# STDIO MCP target → echo 파이프 형태 출력
clip fs read_file --path /etc/hosts --dry-run
# echo '{"jsonrpc":"2.0","id":1,...}' | npx @modelcontextprotocol/server-filesystem /

# CLI target → ACL/prepend 처리 후 실행될 최종 명령어
clip --dry-run gh get pods -n default
# gh get pods -n default
```

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
