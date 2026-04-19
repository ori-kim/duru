# GraphQL Target

GraphQL API 엔드포인트를 clip 게이트웨이에 등록합니다. clip은 introspection으로 오퍼레이션을 자동 탐색합니다.

## 등록

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

# OAuth 2.1 PKCE — `clip login <target>`으로 인증
oauth: false

# 매번 스키마 재fetch 여부 (기본값: false, 캐시 사용)
introspect: false
```

## 실행

```sh
# query, mutation, subscription 전체 목록
clip gql tools

# 타입 정의 확인
clip gql describe User

# 전체 타입 목록
clip gql types

# 이름 있는 오퍼레이션 실행 (스키마 기반 자동 생성)
clip gql getUser --id 123
clip gql createUser --name "Alice" --email "alice@example.com"

# raw query
clip gql query --query '{ users { id name email } }'

# 오퍼레이션 도움말
clip gql getUser --help
```

## 스키마 캐시

introspection으로 스키마를 가져와 `~/.clip/target/graphql/<name>/schema.json`에 캐시합니다.

갱신:

```sh
clip refresh gql
```

## 인증

헤더를 통한 API 키:

```yaml
headers:
  Authorization: "Bearer ${GRAPHQL_TOKEN}"
```

OAuth 2.1 PKCE:

```yaml
oauth: true
```

```sh
clip login gql    # 브라우저 열기 → OAuth 흐름 완료
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
