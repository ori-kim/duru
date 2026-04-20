# 워크스페이스

워크스페이스는 프로젝트나 환경별로 별도의 target 집합을 유지할 수 있게 해줍니다. 활성 워크스페이스가 있을 때 워크스페이스 target이 글로벌 config를 덮어씁니다 — 같은 이름의 target은 워크스페이스 버전이 우선합니다.

## 빠른 시작

```sh
clip workspace new work          # 생성
clip workspace use work          # 전환
clip add notion https://mcp.notion.com/mcp   # 워크스페이스에 등록
clip workspace use -             # 해제 (글로벌로 복귀)
```

## 커맨드

| 커맨드 | 설명 |
|--------|------|
| `clip workspace` | 활성 워크스페이스 및 디렉터리 표시 |
| `clip workspace new <name>` | 워크스페이스 생성 |
| `clip workspace use <name>` | 워크스페이스 전환 |
| `clip workspace use -` | 활성 해제 (글로벌로 복귀) |
| `clip workspace list` | 워크스페이스 목록 |
| `clip workspace remove <name> [--force]` | 워크스페이스 삭제 |

이름 규칙: 영문자·숫자·`_`·`-`만 허용, `.`으로 시작 불가, 예약어(`target`, `bin`, `extensions`, `hooks`)는 사용 불가.

## 디렉터리 구조

```
~/.clip/
  .workspace                   # 활성 워크스페이스 이름 (비어 있으면 글로벌)
  workspace/
    <name>/
      target/                  # 워크스페이스 전용 target
        cli/<name>/config.yml
        mcp/<name>/config.yml
        ...
      .env                     # 워크스페이스 범위 환경변수
```

## 글로벌 vs 워크스페이스 target

`clip add`는 기본적으로 활성 워크스페이스(있는 경우)에 등록합니다. `--global`을 붙이면 워크스페이스와 관계없이 글로벌 config에 강제 등록됩니다:

```sh
clip workspace use work
clip add gh gh               # → ~/.clip/workspace/work/target/cli/gh/
clip add gh gh --global  # → ~/.clip/target/cli/gh/
```

## clip list 워크스페이스 태그

워크스페이스가 활성화된 상태에서 `clip list`를 실행하면 각 target 옆에 흐릿한 `[워크스페이스명]` 또는 `[global]` 태그가 표시됩니다:

```
  notion  https://mcp.notion.com/mcp  [work]
  gh      gh                          [global]
```

## 격리와 우선순위

- 워크스페이스 target이 같은 이름의 글로벌 target보다 우선합니다.
- 워크스페이스 target을 삭제하면 글로벌 target이 있을 경우 복원됩니다 (경고 표시).
- OAuth 토큰, API 키 캐시, spec 파일은 target 디렉터리별로 저장되므로 같은 이름이라도 워크스페이스와 글로벌 버전은 완전히 독립적입니다.

## 워크스페이스 삭제

```sh
clip workspace remove myws --force
```

`--force`를 지정해야 `~/.clip/workspace/myws/` 전체(내부 target·토큰·캐시 포함)가 삭제됩니다. 현재 활성 워크스페이스는 삭제할 수 없으며, 먼저 `clip workspace use -`로 해제해야 합니다.
