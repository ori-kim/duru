# MCP Target

Registers a [Model Context Protocol](https://modelcontextprotocol.io) server with the clip gateway. There are two transport types: **HTTP** and **STDIO**.

## HTTP MCP

Connects to a remote or local HTTP server using JSON-RPC over HTTP (with SSE support).

### Register

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

# Auth method
auth: oauth       # OAuth 2.1 PKCE (authenticate with clip login)
# auth: apikey   # API key — pass via headers
# auth: false    # No auth

# For apikey auth
headers:
  Authorization: "Bearer ${NOTION_API_KEY}"
```

### OAuth Authentication

For servers with `auth: oauth`, authenticate with `clip login`:

```sh
clip login notion
# Opens browser → completes OAuth flow
# Token saved to ~/.clip/target/mcp/notion/auth.json
```

Tokens are refreshed automatically before expiry. To clear:

```sh
clip logout notion
```

### Running

```sh
# List available tools
clip notion tools

# Call a tool
clip notion search_pages --query "sprint retro"
clip notion get_page --page_id abc123
clip notion create_page --parent_id def456 --title "New page"

# Show parameters for a tool
clip notion search_pages --help
```

### How It Works

When you run `clip notion search_pages --query "..."`, clip:

1. Sends `initialize` — MCP handshake
2. Sends `notifications/initialized` — signals session start
3. Calls `tools/list` — fetches tool list and input schemas
4. Calls `tools/call` — executes the tool

```json
{
  "jsonrpc": "2.0",
  "id": 4,
  "method": "tools/call",
  "params": {
    "name": "search_pages",
    "arguments": { "query": "sprint retro" }
  }
}
```

### Dry Run

Preview the JSON-RPC curl command without executing:

```sh
clip notion search_pages --query "sprint retro" --dry-run
```

```sh
curl -X POST 'https://mcp.notion.com/mcp' \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -H 'Authorization: Bearer eyJhbGciOiJSUzI1NiJ9...' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"search_pages","arguments":{"query":"sprint retro"}}}'
```

---

## STDIO MCP {#stdio}

Spawns a local process and communicates via stdin/stdout. Suited for package-based MCP servers run with `npx`, `uvx`, etc.

### Register

```sh
clip add <name> --stdio <command> [args...]
```

```sh
# Notion STDIO MCP (official package)
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

### Running

The interface is identical to HTTP MCP:

```sh
clip notion-stdio tools
clip notion-stdio search_pages --query "sprint retro"
```

### How It Works

When you run `clip notion-stdio search_pages --query "..."`, clip:

1. Spawns `npx -y @notionhq/notion-mcp-server`
2. Sends JSON-RPC messages over stdin
3. Reads the response from stdout
4. Terminates the process

A new process is started for every invocation.

### Dry Run

Preview the JSON-RPC payload as an echo pipe command:

```sh
clip notion-stdio search_pages --query "sprint retro" --dry-run
```

```sh
echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"search_pages","arguments":{"query":"sprint retro"}}}' | npx -y @notionhq/notion-mcp-server
```
