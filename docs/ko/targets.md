# Targets

clip의 모든 동작은 **target**을 통해 이루어집니다. target은 외부 CLI 도구, MCP 서버, REST API를 clip 게이트웨이에 등록한 단위입니다.

등록된 target은 다음과 같이 실행합니다:

```sh
clip <target> <subcommand> [args...]
```

## Target 종류

| 종류 | 설명 | 예시 |
|------|------|------|
| [CLI](./cli.md) | 로컬 CLI 명령어를 ACL로 감싸 실행 | `gh`, `gh`, `gh` |
| [MCP (HTTP)](./mcp.md) | HTTP MCP 서버 (Streamable HTTP) | `notion`, `linear` |
| [MCP (SSE)](./mcp.md#sse) | legacy SSE transport MCP 서버 | 구버전 MCP 서버 |
| [MCP (STDIO)](./mcp.md#stdio) | 로컬 프로세스로 실행되는 MCP 서버 | `filesystem`, `sqlite` |
| [API](./api.md) | OpenAPI 스펙 기반 REST API | GitHub REST API, Petstore |

## 등록 및 관리

```sh
# 등록
clip add gh gh --deny delete
clip add notion https://mcp.notion.com/mcp
clip add myserver --sse https://example.com/sse
clip add github https://api.github.com --openapi-url https://raw.githubusercontent.com/.../openapi.yaml

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
```

`deny`가 `allow`보다 항상 우선합니다.

## Profile

하나의 target에 여러 실행 환경(변형)을 등록할 수 있습니다. args, url, env, headers 등을 profile별로 다르게 지정합니다.

### 등록 및 사용

```sh
# target 등록
clip add mygh gh --allow "get,describe,logs,top"

# profile 추가
clip profile add mygh prod-kr --args "exec,example/prod/kr,--,gh"
clip profile add mygh alpha-kr --args "exec,example/alpha/kr,--,gh"

# active 설정
clip profile use mygh prod-kr

# 실행 (active profile 사용)
clip mygh get pods -n default

# 1회성 override
clip mygh@alpha-kr get pods -n default

# profile 목록 확인
clip profile list mygh

# active 해제
clip profile unset mygh

# profile 삭제
clip profile remove mygh alpha-kr
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

### config.yml 구조 예시

```yaml
command: gh
allow: [get, describe, logs, top]
profiles:
  prod-kr:
    args: [exec, example/prod/kr, --, gh]
  alpha-kr:
    args: [exec, example/alpha/kr, --, gh]
active: prod-kr
```

## 글로벌 플래그

모든 target 실행 시 어디에든 붙일 수 있습니다:

```sh
clip gh pr list --json            # JSON 출력
clip notion search_pages --dry-run  # curl 미리 확인
clip gh pr list --pipe            # TTY라도 버퍼 모드 강제
```

| 플래그 | 설명 |
|--------|------|
| `--json` | 출력을 JSON으로 변환 |
| `--pipe` | TTY 환경에서도 버퍼 모드 강제 (passthrough 비활성화) |
| `--dry-run` | 실제 실행 없이 나가는 요청/명령어 미리 출력 |
