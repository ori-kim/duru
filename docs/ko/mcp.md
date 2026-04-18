# MCP Target

[Model Context Protocol](https://modelcontextprotocol.io) 서버를 clip 게이트웨이에 등록합니다. 연결 방식에 따라 **HTTP**, **SSE**, **STDIO** 세 종류가 있습니다.

## HTTP MCP

원격 또는 로컬 HTTP 서버로 동작하는 MCP 서버입니다. JSON-RPC over HTTP(SSE)로 통신합니다.

### 등록

```sh
clip add <name> <https://...mcp>
```

```sh
clip add notion https://mcp.notion.com/mcp
```

### Config

`~/.clip/target/mcp/notion/config.yml`

```yaml
transport: http
url: https://mcp.notion.com/mcp

# 인증 방식
auth: oauth       # OAuth 2.1 PKCE (clip login으로 인증)
# auth: apikey   # API 키 — headers로 전달
# auth: false    # 인증 없음

# API 키 방식일 때
headers:
  Authorization: "Bearer ${NOTION_API_KEY}"
```

### OAuth 인증

`auth: oauth`로 설정된 MCP 서버는 `clip login`으로 인증합니다:

```sh
clip login notion
# 브라우저가 열리고 OAuth 플로우 진행
# 완료 후 토큰이 ~/.clip/target/mcp/notion/auth.json 에 저장됨
```

토큰은 만료 전 자동으로 갱신됩니다. 수동으로 초기화하려면:

```sh
clip logout notion
```

### 실행

```sh
# 사용 가능한 도구 목록
clip notion tools

# 도구 실행
clip notion search_pages --query "스프린트 회고"
clip notion get_page --page_id abc123
clip notion create_page --parent_id def456 --title "새 페이지"

# 파라미터 확인
clip notion search_pages --help
```

### 동작 방식

clip이 `clip notion search_pages --query "..."` 를 실행하면 내부적으로:

1. `initialize` — MCP 핸드셰이크
2. `notifications/initialized` — 세션 시작 알림
3. `tools/list` — 도구 목록 및 스키마 획득
4. `tools/call` — 실제 도구 호출

```json
{
  "jsonrpc": "2.0",
  "id": 4,
  "method": "tools/call",
  "params": {
    "name": "search_pages",
    "arguments": { "query": "스프린트 회고" }
  }
}
```

### Dry Run

실제 요청 없이 전송될 JSON-RPC curl 명령어를 출력합니다:

```sh
clip notion search_pages --query "스프린트 회고" --dry-run
```

```sh
curl -X POST 'https://mcp.notion.com/mcp' \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -H 'Authorization: Bearer eyJhbGciOiJSUzI1NiJ9...' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"search_pages","arguments":{"query":"스프린트 회고"}}}'
```

---

## SSE MCP {#sse}

**legacy SSE transport** 방식의 MCP 서버에 연결합니다. `GET /sse`로 지속 연결을 열어 응답을 수신하고, `POST /messages`로 요청을 전송합니다. Streamable HTTP transport 이전에 만들어진 구버전 MCP 서버에 사용합니다.

### 등록

```sh
clip add <name> --sse <https://...sse>
```

```sh
clip add myserver --sse https://example.com/sse
```

### Config

`~/.clip/target/mcp/myserver/config.yml`

```yaml
transport: sse
url: https://example.com/sse

# 인증 방식
auth: oauth       # OAuth 2.1 PKCE (clip login으로 인증)
# auth: apikey   # API 키 — headers로 전달
# auth: false    # 인증 없음

# API 키 방식일 때
headers:
  Authorization: "Bearer ${API_KEY}"
```

### OAuth 인증

HTTP MCP와 동일하게 `clip login`으로 인증합니다:

```sh
clip login myserver
clip logout myserver
```

### 실행

HTTP MCP와 동일한 인터페이스로 사용합니다:

```sh
clip myserver tools
clip myserver search --query "안녕"
```

### 동작 방식

`clip myserver search --query "..."` 실행 시:

1. `GET /sse` — 지속 SSE 연결 오픈
2. `endpoint` 이벤트 대기 — 서버가 메시지 URL 전송 (예: `/messages?sessionId=abc123`)
3. `POST <messageUrl>` — `initialize` 전송
4. `notifications/initialized` 전송
5. `tools/list` → `tools/call` — 응답은 SSE 스트림으로 수신

### Dry Run

실제 실행 없이 두 단계 흐름을 미리 확인합니다:

```sh
clip myserver search --query "안녕" --dry-run
```

```sh
# Step 1: SSE 엔드포인트 연결
curl -N 'https://example.com/sse' \
  -H 'Accept: text/event-stream'

# Step 2: 메시지 엔드포인트로 POST ('endpoint' SSE 이벤트에서 URL 획득)
curl -X POST '<messageUrl-from-endpoint-event>' \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"search","arguments":{"query":"안녕"}}}'
```

---

## STDIO MCP {#stdio}

로컬 프로세스를 stdin/stdout으로 연결하는 MCP 서버입니다. `npx`, `uvx` 등으로 실행되는 패키지형 MCP 서버에 적합합니다.

### 등록

```sh
clip add <name> --stdio <command> [args...]
```

```sh
# Notion STDIO MCP (공식 패키지)
clip add notion-stdio --stdio npx -y @notionhq/notion-mcp-server

# Filesystem MCP
clip add fs --stdio npx -y @modelcontextprotocol/server-filesystem $HOME
```

### Config

`~/.clip/target/mcp/notion-stdio/config.yml`

```yaml
transport: stdio
command: npx
args: ["-y", "@notionhq/notion-mcp-server"]

env:
  NOTION_API_KEY: "${NOTION_API_KEY}"
```

### 실행

HTTP MCP와 동일한 인터페이스로 사용합니다:

```sh
clip notion-stdio tools
clip notion-stdio search_pages --query "스프린트 회고"
```

### 동작 방식

`clip notion-stdio search_pages --query "..."` 실행 시:

1. `npx -y @notionhq/notion-mcp-server` 프로세스 시작
2. stdin으로 JSON-RPC 메시지 전송
3. stdout에서 응답 수신
4. 프로세스 종료

매 호출마다 프로세스를 새로 시작합니다.

### Dry Run

전송될 JSON-RPC 페이로드를 echo pipe 형태로 출력합니다:

```sh
clip notion-stdio search_pages --query "스프린트 회고" --dry-run
```

```sh
echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"search_pages","arguments":{"query":"스프린트 회고"}}}' | npx -y @notionhq/notion-mcp-server
```
