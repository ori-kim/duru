---
name: duru-skills
description: Use when discovering, grouping, importing, exporting, or planning usage of duru skills by tags in this repository or an agent skill folder.
tags: [scope:repo, scope:agent, subject:skills, intent:discover, intent:organize, intent:import-export]
---

# duru-skills

`duru skills list`를 단독 탐색 명령으로 사용하지 않는다.
스킬 탐색은 항상 태그 기반 국소 검색으로 시작한다.

## Discovery

1. `duru skills tag list`로 실제 존재하는 태그 카테고리를 확인한다.
2. 작업과 관련 있는 태그를 고른다.
3. `duru skills list --tag <tag>`로 태그별 후보만 확인한다.
4. 후보 스킬의 `SKILL.md`를 열어 적용 여부를 결정한다.

태그 목록 명령이 현재 checkout에서 아직 제공되지 않으면 `duru skills list`로 우회하지 않는다. `SKILL.md` frontmatter의 `tags`를 먼저 스캔한다.

```bash
rg -n "^tags:" skills ~/.agents/skills ~/.claude/skills .agents/skills
```

```bash
duru skills tag list
duru skills list --tag <tag>
duru skills list --tag <tag> --tag <tag>
duru skills list --tag <tag>,<tag>
```

태그 후보가 여러 개면 각 태그별 `duru skills list --tag <tag>` 결과를 비교한다. 같은 스킬이 여러 태그에 걸쳐 나오면 우선순위를 높인다.

## Local Search

전역 스킬 목록을 훑지 않는다. 먼저 요청에서 `scope`, `subject`, `intent` 후보를 추론하고, 실제 존재하는 태그와 교차시킨 뒤 tag-filtered list만 확인한다.

국소 검색 순서:

1. `duru skills tag list`로 facet/value 집합을 확인한다.
2. 가장 집합성이 좋은 `subject:<value>`부터 시도한다.
3. 필요하면 `intent:<value>` 또는 `scope:<value>`로 넓히거나 교차 비교한다.
4. 결과가 없을 때만 한 단계 더 일반적인 value를 고른다.
5. 그래도 없으면 missing tag 후보를 기록하고, 전역 탐색 대신 `SKILL.md` frontmatter tag scan으로 태그 사전을 보강한다.

단일 `--tag`는 해당 태그 집합을 조회한다. 반복 `--tag`와 comma-separated `--tag <tag>,<tag>`는 모두 AND 검색으로 좁힌다. 다중 태그 검색은 `subject:<value>`로 먼저 좁히고 `intent:<value>`나 `scope:<value>`를 추가하는 순서로 사용한다.

## Tag Architecture

태그는 고정 추천 목록이 아니라 스킬 탐색을 위한 색인이다. 새 태그를 만들기 전에 `duru skills tag list`로 기존 태그를 확인한다.

태그는 `key:value` facet 구조를 사용한다. key는 정규화하고, value는 자연스럽게 확장한다.

- `scope:<value>`: 적용 범위나 소유권
- `subject:<value>`: 스킬이 다루는 대상
- `intent:<value>`: 그 스킬을 다시 찾는 목적

`<scope>:<subject>:<intent>`는 단일 태그 문자열이 아니라 사고 모델이다. 실제 태그는 `scope:project`, `subject:karavan`, `intent:stack-branch`처럼 여러 facet으로 붙인다.

확장은 보수적으로 한다.

- 한 스킬에 너무 많은 태그를 붙이지 않는다.
- 한 번만 쓰일 태그는 만들지 않는다.
- 같은 의미를 단수/복수, 약어, 동의어로 나누지 않는다.
- value는 짧은 kebab-case를 사용한다.
- 프로젝트명, 팀명, 제품명은 사용자가 실제로 부르는 이름을 우선한다.
- 기존 단일 태그는 새 규칙의 예외가 아니라 마이그레이션 후보로 본다.
- 태그는 스킬 본문보다 description의 트리거를 보완하는 용도로만 쓴다.

## Import And Export

원본 스킬 보관소는 `$DURU_HOME/skills`다. 레포의 `skills/`는 패키지 개발과 repo-local guidance 위치다. `--from .`과 `--to .`는 현재 디렉터리 기준 상대경로로 해석한다.

`import`와 `export`는 기본적으로 심볼릭 링크를 만든다. 복사본이 필요할 때만 `--copy`를 사용한다.

외부 skill root로 노출되는 이름은 알아보기 쉽게 `duru-<name>` prefix를 붙인다. 예를 들어 `$DURU_HOME/skills/coding`을 export하면 target에는 `duru-coding`으로 생성된다. `import`는 `<name>`과 `duru-<name>` source directory를 모두 인식한다.

```bash
duru skills import <name> --from .
duru skills import <name> --from ~/.agents/skills
duru skills import <name> --from ~/.agents/skills --copy
duru skills export <name>
duru skills export <name> --to .agents/skills
duru skills export <name> --to ~/.claude/skills
duru skills export <name> --copy
```

```bash
duru skills import --all --from ~/.agents/skills
duru skills export --all --to .agents/skills
```

`export --to`를 생략하면 기본 target은 `~/.agents/skills`다.

## Profiles

작업 종류별 스킬 묶음은 명시적 profile로 관리한다. profile은 `$DURU_HOME/skill-profiles/*.yml`에 둔다.

```yaml
name: writing
skills:
  - humanize-korean
  - docs
  - docs-notion
```

```bash
duru skills profile list
duru skills profile show writing
duru skills profile use writing
duru skills profile use dev --to .agents/skills
duru skills profile clear writing
duru skills profile clear --all
duru skills profile status
```

`profile use`는 profile에 적힌 스킬을 target root에 `duru-<name>` symlink로 노출한다. `profile clear <name>`은 해당 profile 스킬만 제거하고, `profile clear --all`은 안전하게 식별되는 duru-managed entry 전체를 제거한다. 직접 만든 `duru-*` 디렉터리는 marker가 없으면 삭제하지 않고 skipped로 보고한다.

## Planning

작업 계획에는 다음을 남긴다.

- 확인한 태그 목록
- 선택한 태그
- 태그로 필터링해 확인한 스킬 후보
- 실제로 사용할 스킬과 제외한 스킬

스킬을 쓰지 않으면 짧게 이유를 적는다.

## Boundaries

- qmd 기반 검색은 `duru-memory`의 책임이다.
- 장기기억 정리, 승격, 아카이브는 `duru-self-improvement-loop`의 책임이다.
- action 구현에서는 stdout에 직접 쓰기보다 renderer-ready result를 반환하는 패턴을 유지한다.
