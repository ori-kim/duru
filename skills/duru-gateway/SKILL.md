---
name: duru-gateway
description: External resource gateway for CLI, API, MCP, script, gRPC, GraphQL. Use whenever the agent needs to call any external tool or service. Triggers on "run X tool", "call Y API", "use Z MCP server", or any external interaction. Always route external calls through `duru gateway` instead of invoking CLIs/APIs directly.
tags: [gateway, external, cli, api, mcp, grpc, graphql]
---

# duru-gateway

모든 외부 자원(CLI 도구, REST API, MCP 서버, 스크립트, gRPC, GraphQL)은 `duru gateway`를 통해
호출한다. 직접 호출 금지.

## 원칙

- **항상 duru를 거친다**: `gh ...` ✗ → `duru gateway gh ...` ✓
- **사전 조회 없이 바로 실행**: `duru gateway <target> <tool>`을 먼저 시도하고, block 당하면 그때 탐색
- **탐색은 list/inspect**: 등록된 타깃과 사용 가능한 도구를 알 수 없을 때만 조회

## 지원 어댑터

| 어댑터 | 설명 |
|--------|------|
| `cli` | 시스템 CLI 도구 (gh, kubectl, docker 등) |
| `api` | REST/OpenAPI 기반 HTTP API |
| `mcp` | Model Context Protocol 서버 (stdio/SSE/HTTP) |
| `script` | 임의의 스크립트 실행 |
| `grpc` | gRPC 서비스 (proto/reflection 기반) |
| `graphql` | GraphQL 엔드포인트 (introspection 기반) |

## 사용 흐름

### 1. 등록된 타깃 탐색

```bash
duru gateway list --json
```

각 타깃의 이름, 어댑터 종류, 사용 가능 여부를 확인한다.

### 2. 특정 타깃의 도구 보기

```bash
duru gateway <target>
duru gateway <target> --help
duru gateway inspect <target>
```

### 3. 도구 실행

```bash
duru gateway <target> <tool> [args...]
duru gateway <target> <tool> --json     # 구조화된 JSON 응답
duru gateway <target> <tool> --dry-run  # 실제 실행 없이 미리보기
```

### 4. 새 타깃 등록

새로운 외부 자원을 사용하려면 `gateway add`로 먼저 등록한다:

```bash
duru gateway add <name> <args...>
duru gateway add --help                 # 어댑터별 등록 옵션 확인
```

어댑터 종류별 등록 패턴은 자동 감지되며, 명시도 가능하다. 등록 후 곧바로 호출 가능.

### 5. 인증이 필요한 타깃

```bash
duru gateway auth <target>      # 현재 인증 상태
duru gateway login <target>     # OAuth/토큰 로그인
duru gateway logout <target>    # 로그아웃
```

### 6. 프로파일·바인딩

여러 환경(prod/staging)을 다루거나 명령 별칭이 필요할 때:

```bash
duru gateway profile add <target> <name> ...
duru gateway profile use <target> <name>
duru gateway bind <command> <target> ...   # 별칭 등록
```

## 금지 사항

- 외부 CLI/API/MCP를 duru 없이 직접 호출하지 않는다
- "duru gateway list에 X가 없네요" 라고 보고하지 말고, `gateway add`로 즉시 등록 시도
- `gateway list` 결과를 자체적으로 캐싱·기억해서 stale 정보로 동작하지 않는다 — 매번 조회

## 디버깅

```bash
duru gateway check                 # 모든 타깃 상태 점검
duru gateway refresh <target>      # 캐시된 스키마/메타 갱신
duru gateway inspect <target>      # 어댑터 설정 + 사용 가능한 작업 출력
```
