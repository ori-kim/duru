# cli-gateway-openapi-discovery history

- Started stacked branch `codex/cli-gateway-openapi-discovery` on top of `codex/cli-gateway-add-detect`.
- Scope: extend the `api` gateway adapter so a single `GatewayTarget` can support raw HTTP requests and OpenAPI-backed operation discovery.
- Added `openapiUrl` and inline `spec` config support while keeping existing `baseUrl` and legacy `url` compatibility.
- Added OpenAPI parsing for operation tools, path/query/header parameters, request body metadata, and server-derived base URLs.
- Added target subcommands:
  - `clip <target> tools`
  - `clip <target> describe <operation>`
  - `clip <target> types`
- Added operation invocation by OpenAPI `operationId`, including query/header/path parameter mapping and request body construction.
- Added `refresh` support for `openapiUrl` targets so fetched specs can be persisted back into the injected `GatewayStore`.
- Added add-command detection for spec-like URLs such as `https://api.example.com/openapi.json`, storing them as `{ openapiUrl }`.
- Verification:
  - `bun run check`
  - `git diff --check`
