# API Target

Reads an OpenAPI spec (JSON or YAML) and auto-generates a CLI tool for each operation. Any REST API with an OpenAPI spec is immediately usable through clip — no custom implementation needed.

## Register

```sh
clip add <name> <baseUrl> [--openapi-url <specUrl>]
```

```sh
# GitHub REST API
clip add github https://api.github.com \
  --openapi-url https://raw.githubusercontent.com/github/rest-api-description/main/descriptions/api.github.com/api.github.com.json
```

`baseUrl` is where HTTP requests are sent. `openapiUrl` is where clip fetches the spec. The spec is cached at `~/.clip/target/api/<name>/spec.json`. If a local spec already exists, `openapiUrl` can be omitted.

## Config

`~/.clip/target/api/github/config.yml`

```yaml
baseUrl: https://api.github.com
openapiUrl: https://raw.githubusercontent.com/.../api.github.com.json

# Auth method
auth: apikey
headers:
  Authorization: "Bearer ${GITHUB_TOKEN}"
  X-GitHub-Api-Version: "2022-11-28"

# ACL
allow: [repos_list_for_org, pulls_list, issues_list_for_repo]
deny: [repos_delete]
```

## Running

```sh
# List available operations
clip github tools

# Show parameters for an operation
clip github pulls_list --help

# Execute
clip github pulls_list --owner ori-kim --repo cli-proxy --state open
clip github issues_list_for_repo --owner ori-kim --repo cli-proxy
clip github repos_get --owner ori-kim --repo cli-proxy
```

## Tool Names

Tool names come from the `operationId` field in the OpenAPI spec. If no `operationId` is present, clip generates one as `{method}_{path}`.

```sh
clip github tools
# Tools:
#   pulls_list                 List pull requests
#   pulls_get                  Get a pull request
#   pulls_create               Create a pull request
#   issues_list_for_repo       List repository issues
#   repos_get                  Get a repository
#   ...
```

## Parameters

clip automatically maps parameters to their correct location (path, query, header, or body) based on the spec.

```sh
# Path parameters: {owner}, {repo}, {pull_number}
clip github pulls_get --owner ori-kim --repo cli-proxy --pull_number 1

# Query parameters
clip github pulls_list --owner ori-kim --repo cli-proxy --state open --per_page 10

# Body parameters (POST/PATCH)
clip github pulls_create \
  --owner ori-kim \
  --repo cli-proxy \
  --title "feat: new feature" \
  --head feature-branch \
  --base main
```

## Refresh Spec

Re-fetch and cache the OpenAPI spec:

```sh
clip refresh github
```

## Dry Run

Preview the curl command that would be sent, including auth headers:

```sh
clip github pulls_list --owner ori-kim --repo cli-proxy --dry-run
```

```sh
curl -X GET 'https://api.github.com/repos/ori-kim/cli-proxy/pulls' \
  -H 'Authorization: Bearer ghp_xxxxxxxxxxxx' \
  -H 'X-GitHub-Api-Version: 2022-11-28'
```

```sh
clip github pulls_create \
  --owner ori-kim --repo cli-proxy \
  --title "feat: new feature" --head feature-branch --base main \
  --dry-run
```

```sh
curl -X POST 'https://api.github.com/repos/ori-kim/cli-proxy/pulls' \
  -H 'Authorization: Bearer ghp_xxxxxxxxxxxx' \
  -H 'X-GitHub-Api-Version: 2022-11-28' \
  -H 'Content-Type: application/json' \
  -d '{"title":"feat: new feature","head":"feature-branch","base":"main"}'
```

## Authentication

### API Key (apikey)

Pass a token via headers. Define variables in `~/.clip/.env` and reference them as `${VAR}` in `config.yml`.

```sh
# ~/.clip/.env
GITHUB_TOKEN=ghp_xxxxxxxxxxxx
```

```yaml
# config.yml
auth: apikey
headers:
  Authorization: "Bearer ${GITHUB_TOKEN}"
```

### OAuth (oauth)

Use for APIs that support OAuth 2.1 PKCE. Requires `baseUrl`.

```yaml
auth: oauth
baseUrl: https://api.example.com
```

```sh
clip login myapi
# Opens browser → OAuth flow → token saved
```
