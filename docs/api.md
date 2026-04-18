# API Target

OpenAPI 스펙(JSON/YAML)을 읽어 각 오퍼레이션을 CLI 도구로 자동 생성합니다. 스펙만 있으면 별도 구현 없이 REST API를 clip으로 호출할 수 있습니다.

## 등록

```sh
clip add <name> <baseUrl> [--openapi-url <specUrl>]
```

```sh
# GitHub REST API
clip add github https://api.github.com \
  --openapi-url https://raw.githubusercontent.com/github/rest-api-description/main/descriptions/api.github.com/api.github.com.json
```

`baseUrl`은 실제 HTTP 요청이 전송되는 주소, `openapiUrl`은 스펙을 가져올 URL입니다.

스펙은 `~/.clip/target/api/<name>/spec.json`에 캐시됩니다. 이미 로컬에 스펙이 있다면 `openapiUrl` 없이도 동작합니다.

## Config

`~/.clip/target/api/github/config.yml`

```yaml
baseUrl: https://api.github.com
openapiUrl: https://raw.githubusercontent.com/.../api.github.com.json

# 인증 방식
auth: apikey
headers:
  Authorization: "Bearer ${GITHUB_TOKEN}"
  X-GitHub-Api-Version: "2022-11-28"

# ACL
allow: [repos_list_for_org, pulls_list, issues_list_for_repo]
deny: [repos_delete]
```

## 실행

```sh
# 사용 가능한 오퍼레이션 목록
clip github tools

# 오퍼레이션 파라미터 확인
clip github pulls_list --help

# 실행
clip github pulls_list --owner ori-kim --repo cli-proxy --state open
clip github issues_list_for_repo --owner ori-kim --repo cli-proxy
clip github repos_get --owner ori-kim --repo cli-proxy
```

## 도구 이름

OpenAPI `operationId`가 도구 이름이 됩니다. 스펙에 `operationId`가 없으면 `{method}_{path}` 형태로 자동 생성됩니다.

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

## 파라미터

OpenAPI 스펙의 파라미터 위치(path / query / header / body)를 자동으로 인식합니다.

```sh
# path parameter: {owner}, {repo}, {pull_number}
clip github pulls_get --owner ori-kim --repo cli-proxy --pull_number 1

# query parameter
clip github pulls_list --owner ori-kim --repo cli-proxy --state open --per_page 10

# body parameter (POST/PATCH)
clip github pulls_create \
  --owner ori-kim \
  --repo cli-proxy \
  --title "feat: new feature" \
  --head feature-branch \
  --base main
```

## 스펙 갱신

캐시된 스펙을 다시 가져오려면:

```sh
clip refresh github
```

## Dry Run

실제 요청 없이 전송될 curl 명령어를 출력합니다. 인증 헤더도 포함됩니다.

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

## 인증

### API 키 (apikey)

헤더로 직접 토큰을 전달합니다. `~/.clip/.env`에 환경변수를 정의하면 config.yml에서 `${VAR}` 형태로 참조할 수 있습니다.

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

OAuth 2.1 PKCE 플로우를 지원하는 API에 사용합니다. `baseUrl`이 필수입니다.

```yaml
auth: oauth
baseUrl: https://api.example.com
```

```sh
clip login myapi
# 브라우저 OAuth 플로우 → 토큰 저장
```
