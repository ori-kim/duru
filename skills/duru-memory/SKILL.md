---
name: duru-memory
description: Use when resolving implicit user context through duru memory, including phrases like "내팀", "내 작업", "내 티켓", "지난번 그 결과", repeated requests, preferences, shared long-term knowledge, or agent handoff context.
tags: [scope:agent, scope:user, scope:shared, subject:memory, subject:context, intent:search, intent:restore]
---

# duru-memory

## Workflow

1. 먼저 qmd context search를 한다. 중복이나 기존 맥락 없이 새 memory를 추가하지 않는다.
2. 태그가 명시되었거나 강하게 추론될 때만 `--tag`를 붙인다.
3. 기존 항목이 있으면 `show`로 확인하고 `tag` 또는 내용 갱신을 우선한다.
4. 대량 삽입이나 자동 정리 중에는 `--no-index` 후 명시적으로 `memory reindex`를 실행한다.
5. 일반 mutation은 background indexing에 맡기고 기다리지 않는다.

## Commands

```bash
memory search "<query>"
memory search "<query>" --tag <tag>
memory search "<query>" --tag <tag> --tag <tag>
memory search "<query>" --tag <tag>,<tag>
memory show <id>
memory tag <id> --add <tag>
memory add "<fact>" --tag <tag>
memory add "<fact>" --tag <tag> --no-index
memory reindex
```

`memory list`는 사용하지 않는다. memory 접근은 qmd 검색 중심이다. 태그 검색은 사용자가 범위를 명시하거나 검색 결과가 너무 넓을 때의 보조 필터다.

## Search

그래프 기반 관계는 아직 만들지 않는다. qmd full-text/vector search가 primary retrieval이다.

검색 순서:

1. 자연어 query로 qmd search를 실행한다.
2. 결과가 너무 넓으면 query를 구체화하거나 `--tag`를 추가한다.
3. 태그를 쓸 때는 `subject:<value>`를 우선한다.
4. 반복 `--tag` 또는 comma-separated tag로 AND 검색을 수행한다.
5. 검색 결과에서 자주 필요한 맥락이 빠지면 memory 본문을 보강한다.

단일 `--tag`는 해당 태그 집합에서 검색한다. 반복 `--tag`와 comma-separated `--tag <tag>,<tag>`는 모두 AND 검색으로 좁힌다.

## Storage

새 memory는 생성 날짜 기준으로 파티셔닝한다.

```text
$DURU_HOME/memory/
  items/
    YYYY-MM-DD/
      <memory-id>.md
  usage/
    YYYY-MM-DD.jsonl
```

qmd collection은 `items/**/*.md`를 인덱싱한다. 기존 `items/<memory-id>.md` flat 파일은 읽기 호환 대상으로만 취급한다.

`memory show`는 item frontmatter를 수정하지 않고 `usage/YYYY-MM-DD.jsonl`에 사용 이벤트를 append한다. review 큐는 memory store의 책임이 아니라 `duru-self-improvement-loop`가 판단한다.

## Tags

태그는 고정 카테고리 목록이 아니라 검색 색인이다. 새 태그를 만들기 전에 기존 태그로 충분한지 먼저 확인한다.

태그는 `key:value` facet 구조를 사용한다. key는 정규화하고, value는 자연스럽게 확장한다.

- `scope:<value>`: 기억이 적용되는 범위
- `subject:<value>`: 기억이 다루는 대상
- `intent:<value>`: 그 기억을 다시 찾는 목적

`<scope>:<subject>:<intent>`는 단일 태그 문자열이 아니라 사고 모델이다. 실제 태그는 `scope:project`, `subject:karavan`, `intent:restore-context`처럼 여러 facet으로 붙인다.

`subject:karavan`처럼 subject 태그가 집합을 만든다. 같은 프로젝트나 도메인에 속한 memory는 같은 subject value를 공유한다.

확장은 보수적으로 한다.

- 한 번만 쓰일 태그는 만들지 않는다.
- 같은 의미의 태그를 철자나 동의어로 나누지 않는다.
- value는 짧은 kebab-case를 사용한다.
- 프로젝트명, 팀명, 제품명은 사용자가 실제로 부르는 이름을 우선한다.
- value가 불확실하면 더 일반적인 값으로 둔다.
- 기존 단일 태그는 새 규칙의 예외가 아니라 마이그레이션 후보로 본다.
- 임시 태그는 정리 루프에서 병합하거나 제거한다.

## Store Policy

저장한다:

- 사용자가 반복해서 알려주는 팀, 프로젝트, 티켓 연결
- 특정 표현이 가리키는 실제 대상
- 자주 요청하는 보고서, 검색 조건, 출력 형식
- 사용자가 정한 장기 선호나 정책

저장하지 않는다:

- 일회성 작업 로그
- 코드로 검증 가능한 사실
- 오래 유지되면 위험한 임시 상태
- token, API key, password, private key, cookie, 인증 헤더
- 사용자가 명시적으로 저장하지 말라고 한 내용

## Writing Rules

- 한 항목에 한 주제만 쓴다.
- 추측을 사실처럼 저장하지 않는다.
- 출처나 연결 대상이 중요하면 본문에 함께 남긴다.
- 민감정보가 보이면 저장하지 말고 사용자에게 확인한다.

## Boundaries

- 사실, 맥락, 연결: memory
- 반복 절차: skill
- 정리, 승격, 아카이브 판단: `duru-self-improvement-loop`
