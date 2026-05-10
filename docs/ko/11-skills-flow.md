# skills-flow

`skills-flow`는 agent skill을 graph 형태로 설계하기 위한 clip user extension입니다. 1차 MVP는 실행 런타임이 아니라 스캐폴딩과 정적 검증 도구입니다.

## 설치

개발 checkout을 user extension으로 등록할 때는 `CLIP_HOME/extensions/extensions.yml`에 다음 entry를 추가합니다.

```yaml
extensions:
  - name: skills-flow
    path: <repo>/extensions/skills-flow
    entry: src/extension.ts
    contributes:
      internalCommands: [skills-flow]
```

## 저장 위치

생성된 패키지는 기존 `clip skills` 저장소와 분리해서 저장합니다.

```text
$CLIP_HOME/
  skills-flow/
    my-skill/
      SKILL.md
      flow.json
      flow-ui.json  # web에서 노드를 움직이면 생성됨
```

`flow.json`은 step 관계의 source of truth입니다. `SKILL.md`는 agent가 이 skill을 발견했을 때 `flow.json`을 읽도록 안내하는 bootstrap entry입니다.
`flow-ui.json`은 React Flow 캔버스 상태만 저장하는 UI 전용 파일입니다.

## flow.json

빈 graph도 valid합니다.

```json
{
  "schemaVersion": "1",
  "name": "my-skill",
  "nodes": [],
  "edges": []
}
```

node는 step의 내용 자체를 담지 않고, markdown source로 연결합니다.

```json
{
  "id": "write-script",
  "type": "script",
  "name": "Write Script",
  "link": "scripts/write-script.md"
}
```

edge는 step 사이의 관계만 표현합니다.

```json
{
  "id": "draft-to-review",
  "from": "draft",
  "to": "review",
  "type": "control.next",
  "name": "Review Draft"
}
```

`node.type`과 `edge.type`은 자유 문자열입니다. CLI core는 의미를 강제하지 않고, 나중에 preset, org policy, custom validator가 stricter rule을 적용할 수 있습니다.

## flow-ui.json

`web`에서 node를 드래그하면 node id 기준으로 캔버스 좌표를 저장합니다. horizontal/vertical layout은 서로 다른 좌표를 가질 수 있습니다.

```json
{
  "schemaVersion": "1",
  "nodePositions": {
    "write-script": {
      "horizontal": { "x": 80, "y": 280 },
      "vertical": { "x": 420, "y": 120 }
    }
  }
}
```

이 파일은 `flow.json` validation에 영향을 주지 않습니다. 레이아웃을 초기화하려면 `flow-ui.json`을 삭제하면 됩니다.

## 명령

```sh
clip skills-flow create my-skill --description "My skill"
clip skills-flow create my-skill --description "My skill" --frontmatter model=gpt-5.2
clip skills-flow create my-skill --description "My skill" --frontmatter-file ./codex-skill.yml
clip skills-flow create my-skill --description "My skill" --force
```

`create`는 `SKILL.md`와 빈 `flow.json`을 생성합니다. 이미 존재하면 실패하고, `--force`를 주면 대상 폴더를 삭제한 뒤 재생성합니다.

```sh
clip skills-flow list
clip skills-flow list --verbose
```

기본 `list`는 `NAME`, `STATUS`, `PATH`만 보여줍니다. `--verbose`는 `NODES`, `EDGES`, `DESCRIPTION`을 추가합니다.

```sh
clip skills-flow show my-skill
clip skills-flow show my-skill --verbose
```

기본 `show`는 요약과 validation issue를 보여줍니다. `--verbose`는 `flow.json` 전체를 pretty print합니다.

```sh
clip skills-flow validate my-skill
clip skills-flow validate my-skill --json
```

`validate`는 error가 있으면 exit code 1로 실패합니다. warning만 있으면 valid로 보고 exit code 0을 유지합니다.

```sh
clip skills-flow web
clip skills-flow web my-skill
clip skills-flow web my-skill --port 3907
```

`web`은 `$CLIP_HOME/skills-flow` 전체 목록과 선택된 패키지의 `flow.json`을 React Flow 기반 대시보드로 보여주는 로컬 웹 서버를 시작합니다. UI는 Tailwind CSS v4, Base UI primitive, shadcn/ui 스타일의 로컬 컴포넌트로 구성합니다. 왼쪽 사이드바에서 skill-flow 패키지를 선택하면 해당 노드 목록이 펼쳐지고, graph는 horizontal/vertical 방향을 전환해서 볼 수 있습니다. node를 클릭하면 `link` markdown 파일의 내용을 오른쪽 패널에서 확인할 수 있습니다. edge를 클릭하면 edge type과 `from`/`to` 관계를 확인할 수 있습니다. node를 드래그하면 `flow.json`은 수정하지 않고 `flow-ui.json`에 캔버스 위치만 저장합니다. 서버는 실행/테스트 런타임이 아닙니다.

## 검증 규칙

error:

- `flow.json`이 없거나 JSON parse에 실패함
- `schemaVersion`이 없거나 지원되지 않음
- `name`이 없음
- `nodes` 또는 `edges`가 배열이 아님
- node의 `id`, `type`, `name`, `link`가 없음
- node id가 중복됨
- node `link`가 상대 경로가 아니거나, `.md` 파일이 아니거나, 스킬 폴더 밖을 가리키거나, 파일이 없음
- edge의 `id`, `from`, `to`, `type`, `name`이 없음
- edge id가 중복됨
- edge `from` 또는 `to`가 없는 node를 참조함
- `entryNode`가 있는데 실제 node id를 참조하지 않음

warning:

- node가 있는데 `entryNode`가 없음
- `flow.json.name`과 폴더 이름이 다름
- `flow.json.name`과 `SKILL.md` frontmatter `name`이 다름
- `SKILL.md`가 없거나 frontmatter를 읽을 수 없음
- `SKILL.md` frontmatter의 `name` 또는 `description`이 없음
