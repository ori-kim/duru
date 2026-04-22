# Skills

스킬은 `~/.clip/skills/<name>/SKILL.md`에 저장되는 재사용 가능한 프롬프트 템플릿입니다. YAML frontmatter로 이름·설명·태그·입력 파라미터를 선언하고, 본문에서 `{{ inputs.key }}` 플레이스홀더로 동적 값을 삽입할 수 있습니다.

## 빠른 시작

```sh
clip skills add my-skill --description "유용한 작업 수행"
# → ~/.clip/skills/my-skill/SKILL.md 생성
$EDITOR ~/.clip/skills/my-skill/SKILL.md

clip skills list
clip skills get my-skill --input key=value
```

## SKILL.md 형식

```markdown
---
name: my-skill
description: clip skills list에 표시되는 짧은 설명
tags: [linear, github, slack]
inputs:
  ticket:
    description: Linear 티켓 ID
    required: true
  branch:
    description: 대상 브랜치
    default: main
---

# My Skill

{{ inputs.ticket }} 티켓 / {{ inputs.branch }} 브랜치 기준으로 다음을 수행하세요:

1. ...
2. ...
```

### Frontmatter 필드

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `name` | string | 예 | 스킬 식별자 (영문자·숫자·`_`·`-`) |
| `description` | string | 예 | `clip skills list` DESCRIPTION 컬럼에 표시 |
| `tags` | string[] | 아니오 | TOOLS 컬럼에 표시; 도메인 분류용 |
| `inputs` | object | 아니오 | 입력 파라미터 선언 |
| `workflow` | string | 아니오 | 향후 runner 연동 예약 필드 |

### 입력 선언

`inputs` 하위 각 키에 사용 가능한 필드:

| 필드 | 타입 | 설명 |
|------|------|------|
| `description` | string | 파라미터 설명 |
| `required` | boolean | 미입력 시 에러 발생 |
| `default` | string | 미입력 시 사용할 기본값 |

본문에서 `{{ inputs.key }}`로 참조합니다.

## 커맨드

| 커맨드 | 설명 |
|--------|------|
| `clip skills add <name> [--description <d>] [--tag a,b]` | 스킬 스캐폴드 생성 |
| `clip skills list [--json]` | 전체 스킬 목록 |
| `clip skills show <name>` | SKILL.md 원문 출력 |
| `clip skills get <name> [--input k=v ...]` | inputs 치환 후 렌더링 |
| `clip skills rm <name>` | 스킬 삭제 |
| `clip skills install <name> --to <agent> [--mode symlink\|copy] [--force]` | 에이전트에 설치 |
| `clip skills uninstall <name> [--from <agent>]` | 에이전트에서 제거 |

## 디렉터리 구조

```
~/.clip/
  skills/
    <name>/
      SKILL.md
```

## 에이전트 설치

```sh
clip skills install my-skill --to claude-code
clip skills install my-skill --to codex --mode copy   # 정적 복사
clip skills uninstall my-skill --from claude-code
```

**지원 에이전트:** `claude-code`, `codex`, `gemini`, `pi`, `cursor`

기본 모드는 `symlink` — 원본 SKILL.md를 수정하면 모든 에이전트에 즉시 반영됩니다. `--mode copy`는 변경 없는 스냅샷이 필요할 때 사용합니다.

`clip skills list`의 AGENTS 컬럼에 설치된 에이전트가 브랜드 컬러 아이콘으로 표시됩니다. clip이 설치하지 않은 기존 경로를 덮어쓰려면 `--force`를 사용하세요.

## inputs 렌더링

```sh
clip skills get my-skill --input ticket=ENG-123 --input branch=feature/x
```

`required` 입력이 누락되면 에러가 발생하고, 선택 입력은 `default` 값으로 대체됩니다. `--json` 플래그를 사용하면 렌더링된 텍스트와 frontmatter를 JSON으로 출력합니다.
