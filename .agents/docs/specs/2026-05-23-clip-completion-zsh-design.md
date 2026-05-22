# @clip/completion-zsh 설계

날짜: 2026-05-23
상태: 검토용 초안

## 목적

`@clip/completion-zsh`는 Clip CLI의 zsh completion script를 생성하는 shell-specific plugin이다. 이 패키지는 command graph, option metadata, target registry, adapter-provided operation metadata를 직접 구현하지 않고, `@clip/core`와 `@clip/cli-gateway`가 제공하는 completion contributor를 소비해서 zsh script로 변환한다.

핵심 원칙은 zsh script가 Clip의 내부 저장소 layout을 직접 읽지 않는 것이다. 기존 방식처럼 `$CLIP_HOME/target`을 shell script에서 훑으면 target layout 변경, profile/alias 정책 변경, adapter 추가에 취약해진다. 새 구조에서는 zsh script가 필요할 때 Clip runtime에 completion query를 요청하고, runtime은 각 contributor의 결과를 합쳐 돌려준다.

## 목표

- `clip completion zsh` command를 제공한다.
- zsh용 completion function과 `compdef` script를 stdout으로 출력한다.
- core command, global option, route option, gateway target, profile, alias, adapter operation을 완성 후보로 제공한다.
- shell-specific rendering은 이 패키지에 두고, completion data source는 core/gateway/adapters에 둔다.
- dynamic completion은 안정적인 query command를 통해 가져온다.
- zsh cache를 사용하되 stale data를 짧은 시간 안에 갱신할 수 있게 한다.
- completion 실패가 interactive shell 입력을 깨뜨리지 않도록 조용히 실패한다.

## 비목표

- bash, fish, nushell completion은 포함하지 않는다.
- help text renderer를 대체하지 않는다.
- `clip list` command를 대체하지 않는다.
- target config file을 직접 parse하지 않는다.
- protocol별 operation discovery를 직접 구현하지 않는다.
- user shell 설정 파일을 수정하지 않는다. 사용자는 출력된 script를 직접 eval하거나 설치한다.

## 패키지 형태

```text
packages/completion-zsh/
  src/index.ts
  src/plugin.ts
  src/render-zsh.ts
  src/query.ts
  src/escape.ts
  src/types.ts
  src/index.test.ts
```

기본 export:

```ts
import { zshCompletionPlugin } from "@clip/completion-zsh";

createCli({ name: "clip" }).use(zshCompletionPlugin());
```

## Command 소유권

`@clip/completion-zsh`는 다음 command를 등록한다.

```text
clip completion zsh
clip completion query --shell zsh -- words...
```

`completion zsh`는 사람이 shell 설정에 넣을 script를 출력한다. `completion query`는 생성된 zsh function이 내부적으로 호출하는 machine-facing command다. query command는 기본 help/list에는 숨길 수 있지만, 테스트와 debugging을 위해 명시 호출은 가능해야 한다.

## Core Completion Contract

`@clip/core`는 shell을 모르는 completion metadata contract를 제공한다.

```ts
type CompletionContext = {
  argv: readonly string[];
  cursor: number;
  current: string;
  previous?: string;
  position: number;
};

type CompletionItem = {
  value: string;
  description?: string;
  kind?: "command" | "option" | "target" | "profile" | "alias" | "operation" | "file" | "value";
  group?: string;
  hidden?: boolean;
};

type CompletionContributor = {
  id: string;
  complete(ctx: CompletionContext): Promise<readonly CompletionItem[]>;
};
```

Core가 기본 제공해야 하는 후보:

- top-level command.
- command alias.
- global option.
- matched command의 local option.
- command metadata의 description/group.

Core는 zsh escape, `_describe`, cache policy를 알지 않는다.

## Gateway Completion Contract

`@clip/cli-gateway`는 target system 후보를 contributor로 제공한다.

제공 후보:

- target name.
- target type별 group.
- active profile과 explicit profile.
- alias name.
- 공통 target subcommand: `tools`, `describe`, `types`.
- adapter가 제공하는 operation/tool/method name.

Adapter interface에는 shell-neutral completion hook을 둔다.

```ts
type GatewayAdapter<TConfig = unknown> = {
  type: string;
  complete?(config: TConfig, ctx: GatewayCompletionContext): Promise<readonly CompletionItem[]>;
};
```

`@clip/cli-gateway`는 adapter completion을 호출하기 전에 target resolve, profile merge, alias policy, ACL visibility policy를 적용한다.

## Zsh Script 동작

생성된 zsh script는 다음 역할만 한다.

1. 현재 `words`, `CURRENT`를 Clip query command 형식으로 전달한다.
2. query 결과 JSON을 읽는다.
3. group별로 `_describe` 또는 `_values`에 전달한다.
4. 실패하면 아무 후보도 출력하지 않고 return한다.

zsh script는 YAML, target directory, profile file을 직접 읽지 않는다.

예상 사용:

```sh
eval "$(clip completion zsh)"
```

선택적으로 command name을 바꿀 수 있다.

```sh
clip completion zsh --name clip-dev
```

## Query Output

`clip completion query`는 JSON을 출력한다.

```json
{
  "items": [
    {
      "value": "test-service",
      "description": "cli",
      "kind": "target",
      "group": "cli targets"
    }
  ]
}
```

출력에는 secret, token, raw header value가 포함되면 안 된다. description은 사람이 볼 수 있는 짧은 문자열이어야 하며, config에서 가져온 값은 adapter/store가 sanitize해야 한다.

## Cache 정책

zsh script는 query 결과를 짧게 cache할 수 있다.

- top-level command와 option은 script generation 시점에 embed해도 된다.
- target list는 30초에서 60초 정도의 짧은 cache를 둘 수 있다.
- adapter operation list는 adapter별로 더 긴 cache를 둘 수 있다.
- query command에 `--no-cache`를 두어 debugging과 test에서 cache를 우회할 수 있게 한다.

Cache invalidation은 완벽할 필요가 없다. CLI completion은 stale candidate가 잠깐 보이는 것보다 shell 입력이 느려지는 것이 더 나쁘다.

## 오류 처리

- `completion zsh`에서 알 수 없는 shell 인자는 usage error를 반환한다.
- `completion query` 실패는 JSON error 대신 빈 `items`를 반환할 수 있다. interactive completion에서는 조용한 실패가 우선이다.
- debug mode에서는 stderr에 원인을 출력할 수 있다.
- contributor 하나가 실패해도 다른 contributor 결과는 가능하면 유지한다.
- zsh escaping은 single quote, colon, newline, backslash를 안전하게 처리해야 한다.

## 보안과 개인정보

- completion output은 token, env value, auth header, account id, workspace id를 노출하지 않는다.
- target detail은 adapter가 명시적으로 안전하다고 판단한 요약만 보여준다.
- shell script에서 user input을 command string으로 직접 eval하지 않는다.
- query 호출은 argv array 형태로 구성해야 하며, zsh string interpolation은 escape helper를 거친다.

## 테스트

Unit test:

- zsh escape helper.
- static command/option rendering.
- grouped `_describe` rendering.
- query JSON parsing.
- empty result handling.
- contributor failure isolation.
- `--name` command name override.

Integration test:

- fake core command graph로 `clip completion zsh` script 생성.
- fake gateway contributor로 target 후보 생성.
- `completion query`가 target/profile/operation 후보를 JSON으로 반환.
- stale cache 없이 `--no-cache`가 contributor를 다시 호출.

수동 확인:

- `eval "$(clip completion zsh)"` 후 top-level command 후보가 보인다.
- `clip <TAB>`에서 target과 command가 group으로 나뉜다.
- `clip test-service <TAB>`에서 target subcommand 또는 adapter operation이 보인다.

## 도입 계획

1. `@clip/core`에 shell-neutral completion contributor API를 추가한다.
2. `@clip/completion-zsh`를 추가하고 static command/option completion만 먼저 지원한다.
3. `completion query` command와 JSON output contract를 추가한다.
4. `@clip/cli-gateway`가 target/profile/alias contributor를 제공하게 한다.
5. CLI adapter completion은 원본 command completion으로 delegate하는 방식을 검토한다.
6. MCP/OpenAPI/GraphQL/gRPC adapter는 operation/tool/method 후보를 contributor로 제공한다.
7. zsh cache와 debug option을 추가한다.

## 검토 메모

`help`, `list`, `completion`은 모두 "CLI가 무엇을 알고 있는가"를 보여주지만 소유권은 다르다. `help`는 core metadata renderer이고, `list`는 `@clip/cli-gateway`의 target registry command이며, `completion zsh`는 shell-specific renderer다. 따라서 세 기능이 같은 metadata/contributor contract를 공유하되, 하나의 패키지로 합치지는 않는다.
