---
name: duru-self-improvement-loop
description: Use when periodically reviewing duru skills and memory for cleanup, archival, promotion, compression, or migration between repository and personal agent stores.
tags: [scope:duru, subject:knowledge, subject:archive, subject:memory, subject:skills, intent:cleanup, intent:review, intent:promote]
---

# duru-self-improvement-loop

## Rules

- 자동 삭제보다 검토 가능한 정리를 우선한다.
- 제거 후보는 `$DURU_HOME/archive/` 아래로 이동한다.
- `$DURU_HOME`이 없으면 duru의 기본 home resolver가 쓰는 위치를 따른다.
- background 실행 중에는 삭제, 전역 설치, 원본 변경을 하지 않는다.
- secret, token, credential, cookie, private key가 보이면 archive하지 말고 사용자에게 보고한다.

## Inputs

- skills: `skills tag list`를 먼저 확인하고 `skills list --tag <tag>`로 후보를 좁힌다. 전역 `skills list`는 사용하지 않는다.
- memory: qmd `memory search "<query>"`로 접근하고, 필요한 경우에만 `--tag`로 좁힌다. `memory list`는 사용하지 않는다.
- usage/history: 가능하면 `memory/usage/YYYY-MM-DD.jsonl`의 호출 횟수, 최근 사용 시각, 검색 히트, 세션 언급 횟수를 참고한다.

## Loop

```bash
skills tag list
skills list --tag <tag>
skills list --tag <tag> --tag <tag>
skills list --tag <tag>,<tag>
memory search "<query>"
memory search "<query>" --tag <tag>
memory search "<query>" --tag <tag> --tag <tag>
memory search "<query>" --tag <tag>,<tag>
```

1. 태그 카테고리와 태그별 스킬 후보를 확인한다.
2. qmd memory 검색으로 반복 맥락과 중복 항목을 찾는다.
3. 후보를 `Keep`, `Compress`, `Archive Candidate`, `Promote Candidate`로 분류한다.
4. 변경 전 요약을 사용자에게 보여준다.
5. 승인된 항목만 이동, 압축, 승격한다.

## Candidate Actions

| 그룹 | 처리 |
| --- | --- |
| Keep | 그대로 둔다. 태그가 부족하면 보강한다. |
| Compress | 중복 memory를 하나로 압축하거나 스킬 본문을 줄인다. |
| Archive Candidate | `$DURU_HOME/archive/`로 이동하고 삭제 예정 사유를 남긴다. |
| Promote Candidate | memory를 skill 후보로 만들거나 repo skill을 user skill 후보로 제안한다. |

## Archive Location

셸 예시는 `${DURU_HOME:-$HOME/.duru}/archive`처럼 기본값을 명시한다.

```text
$DURU_HOME/archive/
  YYYY-MM-DD/
    skills/
      <skill-name>/
        SKILL.md
        archive.md
    memory/
      <memory-id>.md
      archive.md
    promotions/
      memory-to-skill/
        <name>.md
      repo-to-user-skill/
        <name>.md
```

`archive.md`에는 최소한 다음을 적는다.

- 원본 경로 또는 memory id
- 아카이브 사유
- 근거가 된 사용 이력
- 제안 삭제일
- 복구 방법

## Promotion Rules

- memory가 같은 절차나 판단 규칙을 반복 설명하면 skill 후보로 제안한다.
- repo skill이 여러 레포나 세션에서 반복 사용되면 `~/.agents/skills` 후보로 제안한다.
- 승격은 제안이 기본값이다. 실제 이동은 사용자 확인 뒤 수행한다.

## Compression Rules

- skill description은 트리거 조건 중심으로 유지한다.
- memory는 한 항목에 한 주제만 남긴다.
- 태그는 검색에 실제 쓰이는 이름으로 합친다.
- 오래된 동의어 태그가 있으면 대표 태그로 통합한다.

## Output

```text
Checked tags: scope:duru, subject:memory, intent:cleanup, ...
Kept: 12
Compressed: 3
Archived candidates: 2
Promotion candidates: 1
Archive root: $DURU_HOME/archive/
Needs user review: yes
```
