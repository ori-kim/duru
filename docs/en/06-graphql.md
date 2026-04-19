# GraphQL Target

Registers a GraphQL API endpoint. clip uses introspection to discover operations and auto-generate CLI tools.

## Register

```sh
clip add <name> <https://...graphql> --graphql
```

```sh
clip add gql https://api.example.com/graphql --graphql
```

## Config

`~/.clip/target/graphql/gql/config.yml`

```yaml
endpoint: https://api.example.com/graphql
headers:
  Authorization: "Bearer ${GRAPHQL_TOKEN}"

# OAuth 2.1 PKCE — use `clip login <target>` to authenticate
oauth: false

# Re-fetch schema on every use (default: false, uses cache)
introspect: false
```

## Running

```sh
# List all queries, mutations, and subscriptions
clip gql tools

# Show a type definition
clip gql describe User

# List all types
clip gql types

# Execute a named operation (auto-generated from schema)
clip gql getUser --id 123
clip gql createUser --name "Alice" --email "alice@example.com"

# Raw query
clip gql query --query '{ users { id name email } }'

# Operation help
clip gql getUser --help
```

## Schema Cache

Schema is fetched via introspection and cached at `~/.clip/target/graphql/<name>/schema.json`.

Refresh:

```sh
clip refresh gql
```

## Authentication

API key via headers:

```yaml
headers:
  Authorization: "Bearer ${GRAPHQL_TOKEN}"
```

OAuth 2.1 PKCE:

```yaml
oauth: true
```

```sh
clip login gql    # opens browser → completes OAuth flow
clip logout gql
```

## Dry Run

```sh
clip gql getUser --id 123 --dry-run
# curl -X POST 'https://api.example.com/graphql' \
#   -H 'Content-Type: application/json' \
#   -H 'Authorization: Bearer eyJ...' \
#   -d '{"query":"..."}'
```
