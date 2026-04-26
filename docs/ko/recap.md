# recap — 개인화된 암묵지 저장소

## 왜 만들었나

`clip list`로 보이는 target은 어떤 외부 도구가 등록되어 있는지만 알려준다. 실제 작업에는 target 목록만으로 알 수 없는 개인화된 정보가 필요한 경우가 많다 — 그 사람만 아는 도메인 컨텍스트, 조직 구조, 프로세스 컨벤션 같은 것들. `recap`은 그런 암묵지를 entry로 저장해 두고 에이전트가 호출 가능하게 만들어, 다른 사람·세션·에이전트가 동일한 컨텍스트로 작업할 수 있게 한다.

## 모델

- **Targets**: clip에 등록된 외부 도구와 1:1 대응하는 recap 그룹 (`slack`, `notion`, `linear` 등). `clip <target>` 사용 시 자연스럽게 노출.
- **Bundles**: 특정 도구에 매핑되지 않는 도메인 묶음. 조직·팀·persona·process 같은 추상 엔터티.

## 디렉터리 구조

```
~/.clip/recap/
  <group>/
    index.json          # entry 메타데이터: name, description, updatedAt, file
    reference/
      <entry>.md        # entry 본문
```

## 사용법

`skills/recap/SKILL.md` 또는 `clip recap --help` 참조.
