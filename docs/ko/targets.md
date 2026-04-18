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
