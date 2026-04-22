# CLI Target

로컬에 설치된 CLI 명령어(`gh`, `git` 등)를 clip 게이트웨이에 등록합니다.

clip은 명령어를 **ACL 검사 후 그대로 실행**합니다. 출력은 TTY에서 passthrough(실시간 스트림), pipe에서 버퍼 모드로 동작합니다.

## 등록

```sh
clip add <name> <command> [--allow x,y] [--deny z] [--args prepend-args]
```

```sh
# gh 등록 — delete 서브커맨드 차단
clip add gh gh --deny delete

# prepend args: clip mygh 실행 시 항상 --hostname 삽입
clip add mygh gh --args "--hostname,github.example.com"
```

## Config

`~/.clip/target/cli/gh/config.yml`

```yaml
command: gh

# 실행 시 항상 앞에 삽입되는 인수
args: []

# 환경변수 주입
env:
  GH_TOKEN: "${GH_TOKEN}"

# 최상위 ACL
allow: [pr, repo, issue]
deny: [delete]

# 트리 ACL
acl:
  pr:
    allow: [list, view, create, checkout]
    deny: [close, merge, delete]
  repo:
    deny: [delete, rename]
```

## 실행

```sh
# passthrough 모드 (TTY) — gh 출력이 실시간으로 그대로 표시됨
clip gh pr list
clip gh repo view ori-kim/cli-proxy

# 버퍼 모드 (pipe / --pipe) — 출력을 캡처해서 반환
clip gh pr list --pipe
clip gh pr list | jq '.[0].number'

# JSON 출력 — stdout을 JSON으로 래핑
clip gh pr list --json
```

## ACL

ACL은 `clip add`의 `--allow` / `--deny` 플래그로 설정하거나, config.yml을 직접 편집합니다.

```sh
# 최상위: pr, repo, issue만 허용
clip add gh gh --allow pr,repo,issue

# 최상위: delete만 차단
clip add gh gh --deny delete
```

트리 규칙은 config.yml에서 `acl:` 필드로 지정합니다:

```yaml
# gh pr 은 list/view/create/checkout 만 허용
# gh repo delete 는 차단
acl:
  pr:
    allow: [list, view, create, checkout]
  repo:
    deny: [delete]
```

ACL을 위반하면 실행 없이 오류를 반환합니다:

```sh
clip gh repo delete my-repo
# clip: denied: "delete" is not allowed for target "gh"
```

## Native Bind

`clip` 접두사 없이 `gh` 명령어 그대로 clip을 통해 실행하려면 bind를 사용합니다:

```sh
clip bind gh
```

`~/.clip/bin/gh` 심링크가 생성됩니다. PATH 앞에 추가하면 `gh` 입력 시 clip을 통해 라우팅됩니다:

```sh
export PATH="$HOME/.clip/bin:$PATH"

gh pr list     # 실제로는 clip gh pr list 실행
```

## Dry Run

실제 실행 없이 최종 명령어를 미리 확인합니다:

```sh
clip gh pr list --label bug --dry-run
# gh pr list --label bug

clip gh repo clone ori-kim/cli-proxy --dry-run
# gh repo clone ori-kim/cli-proxy
```

prepend args가 있으면 포함되어 출력됩니다:

```sh
# config: args: ["--hostname", "github.example.com"]
clip mygh pr list --dry-run
# gh --hostname github.example.com pr list
```
