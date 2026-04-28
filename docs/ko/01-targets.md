# Targets

clip의 모든 동작은 **target**을 통해 이루어집니다. target은 외부 CLI 도구, MCP 서버, API를 clip 게이트웨이에 등록한 단위입니다.

등록된 target은 다음과 같이 실행합니다:

```sh
clip <target> <subcommand> [args...]
```

## Target 종류

| 종류 | 설명 | 예시 |
|------|------|------|
| [CLI](./02-cli.md) | 로컬 CLI 명령어를 ACL로 감싸 실행 | `gh`, `git` |
| [MCP (HTTP)](./03-mcp.md) | HTTP MCP 서버 (Streamable HTTP) | `notion`, `linear` |
| [MCP (SSE)](./03-mcp.md#sse) | legacy SSE transport MCP 서버 | 구버전 MCP 서버 |
| [MCP (STDIO)](./03-mcp.md#stdio) | 로컬 프로세스로 실행되는 MCP 서버 | `filesystem`, `sqlite` |
| [API](./04-api.md) | OpenAPI 스펙 기반 REST API | GitHub REST API, Petstore |
| [gRPC](./05-grpc.md) | gRPC 서버 (reflection 또는 proto 파일) | 내부 서비스 |
| [GraphQL](./06-graphql.md) | introspection 기반 GraphQL API | GraphQL 엔드포인트 |
| [Script](./07-aliases.md#script-target) | 이름 있는 쉘 스크립트를 target으로 묶기 | 개발 자동화 |

## 등록 및 관리

```sh
# 등록
clip add gh gh --deny delete
clip add notion https://mcp.notion.com/mcp
clip add myserver --sse https://example.com/sse
clip add github https://api.github.com --openapi-url https://raw.githubusercontent.com/.../openapi.yaml
clip add my-api localhost:50051 --grpc ./api.proto
clip add gql https://api.example.com/graphql --graphql
clip add my-scripts --script

# 목록 확인
clip list

# 삭제
clip remove gh
```

## Config 파일 위치

```
~/.clip/target/
  cli/<name>/config.yml
  mcp/<name>/config.yml
  api/<name>/config.yml
        spec.json          # 캐시된 OpenAPI 스펙
        auth.json          # OAuth / API key 토큰
  grpc/<name>/config.yml
        schema.json        # 캐시된 gRPC 스키마
  graphql/<name>/config.yml
        schema.json        # 캐시된 GraphQL 스키마
  script/<name>/config.yml
```

## 공통 필드

모든 target config.yml에 사용할 수 있는 공통 필드입니다.

```yaml
# ACL — 최상위 서브커맨드 허용/차단
allow: [pr, repo]
deny: [delete]

# ACL 트리 — 서브커맨드 하위까지 제어
acl:
  pr:
    allow: [list, view, create]
    deny: [close, merge]
  repo:
    deny: [delete]

# 인증 방식
auth: false        # 없음 (기본값)
auth: oauth        # OAuth 2.1 PKCE
auth: apikey       # 헤더로 직접 전달

# 헤더 (auth: apikey 또는 커스텀 헤더)
headers:
  Authorization: "Bearer ${GITHUB_TOKEN}"
  X-Custom-Header: "value"

# Alias — 커스텀 서브커맨드 단축키
aliases:
  my-alias:
    subcommand: real-subcommand
    args: ["--flag", "value"]
    description: "단축키 설명"
```

`deny`가 `allow`보다 항상 우선합니다.

## Profile

하나의 target에 여러 실행 환경(변형)을 등록할 수 있습니다. args, url, env, headers 등을 profile별로 다르게 지정합니다.

### 등록 및 사용

```sh
# target 등록
clip add mygh gh --allow "pr,issue,repo"

# profile 추가
clip profile add mygh work --env "GH_TOKEN=${GH_TOKEN_WORK}"
clip profile add mygh personal --env "GH_TOKEN=${GH_TOKEN_PERSONAL}"

# active 설정
clip profile use mygh work

# 실행 (active profile 사용)
clip mygh pr list

# 1회성 override
clip mygh@personal issue list

# profile 목록 확인
clip profile list mygh

# active 해제
clip profile unset mygh

# profile 삭제
clip profile remove mygh personal
```

### Profile 커맨드

| 커맨드 | 설명 |
|--------|------|
| `clip profile add <target> <profile> [opts]` | profile 생성/업데이트 |
| `clip profile remove <target> <profile>` | profile 삭제 |
| `clip profile list <target>` | profile 목록 및 active 표시 |
| `clip profile use <target> <profile>` | active profile 설정 |
| `clip profile unset <target>` | active 해제 |
| `clip <target>@<profile> <args>` | 1회성 override |

### profile add 플래그

| 플래그 | 적용 대상 | 설명 |
|--------|-----------|------|
| `--args a,b,c` | CLI, STDIO MCP | prepend args 교체 |
| `--command <cmd>` | CLI, STDIO MCP | base command 교체 |
| `--env KEY=VAL` | CLI, STDIO MCP | 환경변수 추가 (반복 사용 가능) |
| `--url <url>` | MCP HTTP/SSE | endpoint URL 교체 |
| `--endpoint <url>` | GraphQL | endpoint 교체 |
| `--address <host:port>` | gRPC | address 교체 |
| `--base-url <url>` | API | baseUrl 교체 |
| `--header KEY:VAL` | MCP/API/gRPC/GraphQL | 헤더 추가 (반복 사용 가능) |
| `--metadata KEY=VAL` | gRPC | metadata 추가 (반복 사용 가능) |

### Merge 규칙

- `args`, `url`, `command`, `address` 등: profile 값이 target 값을 **교체**
- `env`, `headers`, `metadata`: target 기본값 위에 profile 값을 **병합** (profile 우선)
- `allow`, `deny`, `acl`: target에서만 관리 (profile이 ACL 우회 불가)

## 글로벌 플래그

모든 target 실행 시 어디에든 붙일 수 있습니다:

```sh
clip gh pr list --json-output              # JSON 출력
clip notion search_pages --dry-run  # curl 미리 확인
clip gh pr list --pipe              # TTY라도 버퍼 모드 강제
```

| 플래그 | 설명 |
|--------|------|
| `--json-output` | 출력을 JSON으로 변환 |
| `--pipe` | TTY 환경에서도 버퍼 모드 강제 (passthrough 비활성화) |
| `--dry-run` | 실제 실행 없이 나가는 요청/명령어 미리 출력 |
