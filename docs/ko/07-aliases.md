# Aliases & Scripts

## Aliases

모든 target 타입에서 **alias**를 정의할 수 있습니다 — 실제 서브커맨드로 확장되는 단축 커맨드로, 인수 placeholder를 지원합니다.

### Config

target의 `config.yml`에 `aliases` 블록을 추가합니다:

```yaml
# ~/.clip/target/mcp/notion/config.yml
aliases:
  sprint:
    subcommand: search_pages
    args: ["--query", "sprint retro"]
    description: "스프린트 회고 페이지 검색"

  page:
    subcommand: get_page
    input:
      page_id: "$1"
    description: "ID로 페이지 가져오기"
```

### Placeholder

| Placeholder | 의미 |
|-------------|------|
| `$@` | 사용자 인수 전체를 개별 토큰으로 전개 |
| `$*` | 사용자 인수 전체를 공백으로 이어 붙임 |
| `$1`, `$2`, … | 순서 있는 인수 (1부터 시작) |
| `${VAR}` | target env 또는 process env의 환경변수 |
| `$$` | 리터럴 `$` |

placeholder가 없으면 사용자 인수는 template 뒤에 **그대로 추가**됩니다.

### 사용

```sh
clip notion sprint              # → clip notion search_pages --query "sprint retro"
clip notion sprint q2-review    # → clip notion search_pages --query "sprint retro" q2-review
clip notion page abc123         # → clip notion get_page (page_id: "abc123" 전달)
```

alias는 MCP, CLI, API, gRPC, GraphQL, Script 모든 target 타입에서 사용 가능합니다.

---

## Script Target

여러 쉘 명령어(인라인 스크립트 또는 외부 파일)를 하나의 clip target으로 묶습니다.

### 등록

```sh
clip add my-scripts --script
```

이후 `~/.clip/target/script/my-scripts/config.yml`을 직접 편집하세요.

### Config

```yaml
description: "개발 스크립트 모음"

commands:
  deploy:
    script: |
      echo "$1 환경에 배포 중..."
      ./deploy.sh "$1"
    args: [env]
    description: "환경에 배포"

  greet:
    file: ./scripts/greet.sh    # 외부 실행 파일
    args: [name]
    description: "인사하기"
    env:
      GREETING: "안녕"
```

`script`와 `file`은 상호 배타적 — 하나만 지정해야 합니다. 외부 파일은 실행 권한이 있어야 합니다 (`chmod +x`).

### 실행

```sh
# 커맨드 목록
clip my-scripts tools

# 커맨드 실행
clip my-scripts deploy production
clip my-scripts greet Alice

# 커맨드 도움말
clip my-scripts deploy --help
```

### Dry Run

```sh
clip my-scripts deploy production --dry-run
# script:
# echo "$1 환경에 배포 중..."
# ./deploy.sh "$1"
# args: ["production"]
```

### Script target의 Alias

Script target도 alias를 지원합니다 — 다른 커맨드를 호출하는 단축키:

```yaml
commands:
  deploy:
    script: ./deploy.sh $@
    args: [env]
aliases:
  ship:
    subcommand: deploy
    args: ["production"]
    description: "프로덕션 배포"
```

```sh
clip my-scripts ship    # → clip my-scripts deploy production
```
