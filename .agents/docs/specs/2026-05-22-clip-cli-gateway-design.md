# @clip/cli-gateway 설계

날짜: 2026-05-22
상태: 검토용 초안

## 목적

`@clip/cli-gateway`는 Clip의 target gateway 기능을 소유하는 패키지다. runtime, protocol adapter, target store, target-facing command를 하나의 installable CLI plugin으로 묶는다.

이 패키지가 필요한 이유는 target system이 generic CLI framework 관심사가 아니기 때문이다. target system은 외부 tool/protocol을 등록하고, policy를 적용하고, invocation을 routing하고, `add`, `list`, `remove`, `login`, `logout`, `profile` 같은 관리 command를 노출하는 제품 기능이다.

## 목표

- `@clip/core`의 CLI framework에 설치할 수 있는 `cliGateway()` plugin을 제공한다.
- target gateway command를 소유한다: add, list, remove, refresh, login, logout, profile, alias, bind, unbind, binds.
- target invocation routing을 소유한다: `clip <target> <subcommand> [...args]`.
- CLI, MCP, OpenAPI REST, GraphQL, gRPC, script target을 위한 기본 adapter를 포함한다.
- runtime, adapter, command code는 내부적으로 분리하되 하나의 semantic package로 배포한다.
- `@clip/config`는 home/layout/file-store primitive로만 사용한다.
- 가능한 경우 기존 target layout과의 호환 경로를 유지한다.
- 나중에 외부 adapter를 붙일 수 있도록 안정적인 adapter interface를 제공한다.

## 비목표

- app update command는 포함하지 않는다. `clip update`는 distribution-level behavior다.
- 일반 app plugin installer는 포함하지 않는다. Extension installation은 plugin platform package 책임이다.
- skills registry는 포함하지 않는다. Skills는 별도의 제품 기능이다.
- secure token backend는 이 패키지에 포함하지 않는다. Auth adapter는 별도 auth package에 의존할 수 있다.
- `@clip/core`에 있어야 할 broad framework API를 제공하지 않는다.

## 패키지 형태

```text
packages/cli-gateway/
  src/index.ts
  src/plugin.ts
  src/runtime/
  src/store/
  src/commands/
  src/adapters/
    cli/
    mcp/
    openapi/
    graphql/
    grpc/
    script/
  src/output/
  src/types.ts
```

나중에 subpath export를 열 수 있지만, 기본 public surface는 다음과 같다.

```ts
import { cliGateway, defaultGatewayAdapters } from "@clip/cli-gateway";

createCli({ name: "clip" }).use(
  cliGateway({
    home,
    adapters: defaultGatewayAdapters(),
  }),
);
```

## 내부 경계

### Store

Store는 target-system data를 소유하고, file IO에는 `@clip/config`를 사용한다.

책임:

- target config load/save.
- target-local `.env` file load.
- 여러 type에 걸친 target name resolution.
- profile 관리.
- alias 관리.
- bind state가 file-backed일 경우 bind metadata 관리.
- configured compatibility storage 보존.

Store는 target/profile/alias schema를 안다. `@clip/config`는 이 schema를 모른다.

권장 compatibility layout:

```text
$CLIP_HOME/target/<type>/<name>/config.yml
$CLIP_HOME/target/<type>/<name>/.env
```

구체적인 migration 이유가 생기기 전까지 첫 버전은 이 layout을 유지하는 것이 좋다.

### Runtime

Runtime은 invocation execution을 소유한다.

책임:

- target invocation parse.
- target과 optional profile resolve.
- target alias expansion.
- ACL과 command policy 적용.
- lifecycle hook 실행.
- 선택된 adapter 호출.
- timeout과 abort signal 적용.
- `GatewayResult` 반환.
- output을 render하거나 configured renderer에 넘김.

Runtime은 파일을 직접 읽거나 쓰지 않는다. Store interface를 사용한다.

### Adapters

Adapter는 target type별 동작을 구현한다.

```ts
type GatewayAdapter<TConfig = unknown> = {
  type: string;
  schema: GatewaySchema<TConfig>;
  detect?(input: AddInput): boolean | Promise<boolean>;
  add?(input: AddInput): Promise<TConfig>;
  normalize?(config: TConfig, ctx: NormalizeContext): TConfig | Promise<TConfig>;
  execute(config: TConfig, ctx: ExecuteContext): Promise<GatewayResult>;
  describeTools?(config: TConfig, ctx: DescribeContext): Promise<readonly GatewayTool[] | null>;
  refresh?(config: TConfig, ctx: RefreshContext): Promise<TConfig | void>;
  login?(config: TConfig, ctx: AuthContext): Promise<void>;
  logout?(config: TConfig, ctx: AuthContext): Promise<void>;
  listRow?(config: TConfig, ctx: ListContext): Promise<GatewayListRow>;
  completion?(): string;
};
```

기본 adapter:

- `cli`: local CLI execution과 passthrough.
- `mcp`: HTTP, SSE, stdio MCP server.
- `openapi`: OpenAPI REST operation discovery와 execution.
- `graphql`: introspection, query, mutation execution.
- `grpc`: protobuf 또는 reflection 기반 service call.
- `script`: target으로 저장된 named script.

### Commands

Gateway command는 target system을 위한 product command다.

포함:

- `clip add <name> ...`
- `clip list`
- `clip remove <name>`
- `clip refresh <target>`
- `clip login <target>`
- `clip logout <target>`
- `clip profile add/use/list/remove/unset ...`
- `clip alias add/list/remove ...`
- `clip bind <target>`
- `clip unbind <target>`
- `clip binds`

Target subcommand는 runtime이 routing한다.

- `clip <target> tools`
- `clip <target> describe <operation>`
- `clip <target> types`
- `clip <target> <operation> [...args]`

패키지 밖에 두는 command:

- `clip update`
- `clip ext ...`
- `clip skills ...`

`completion`은 나눌 수 있다. app은 top-level command를 소유하고, `@clip/cli-gateway`는 target과 adapter completion contributor를 제공한다.

## 공개 API

```ts
type CliGatewayOptions = {
  home: ClipHome;
  adapters?: readonly GatewayAdapter[];
  compatibility?: {
    targetLayout?: "legacy" | "scoped";
  };
  output?: GatewayOutputOptions;
};

declare function cliGateway(options: CliGatewayOptions): CliPlugin;
declare function defaultGatewayAdapters(): readonly GatewayAdapter[];
```

Adapter authoring type은 공개한다.

```ts
export type {
  GatewayAdapter,
  GatewayResult,
  GatewayTool,
  GatewayStore,
  AddInput,
  ExecuteContext,
  AuthContext,
};
```

Runtime internal은 실제 extension use case가 생기기 전까지 공개하지 않는다.

## Core 통합

`@clip/cli-gateway`는 일반 command가 match되지 않은 뒤 target invocation을 실행할 방법이 필요하다. 가능한 통합 방식은 두 가지다.

1. plugin이 unmatched argv에 대해 register할 수 있는 core fallback hook을 추가한다.
2. gateway가 terminal middleware를 설치하고 route handled 여부를 관찰한다.

fallback hook이 더 깔끔하다. target routing은 일반 literal command가 아니기 때문이다. 이 hook은 argv, parsed global options, handled result를 반환하는 방법을 받을 수 있다.

## Invocation Flow

```text
argv
  -> core parses global options
  -> gateway fallback receives unmatched argv
  -> gateway parser identifies target token and profile
  -> store loads target config
  -> store merges active and explicit profile
  -> runtime expands aliases
  -> runtime checks ACL
  -> runtime runs subcommand-start hooks
  -> adapter executes operation
  -> runtime runs subcommand-end or error hooks
  -> output renderer writes result
```

예를 들어:

```text
clip test-service getItem --id 1 --json
```

위 invocation은 `test-service`를 resolve하고, 해당 adapter를 선택하고, `getItem`을 실행한 뒤 JSON으로 render한다.

## 데이터 모델

Target config는 adapter가 소유하되, 공통 field는 공유한다.

```ts
type GatewayTargetBase = {
  type: string;
  allow?: readonly string[];
  deny?: readonly string[];
  acl?: AclTree;
  aliases?: Record<string, GatewayAlias>;
  profiles?: Record<string, GatewayProfile>;
  timeoutMs?: number;
};
```

Adapter config는 이 base를 확장한다. 예시는 `test-service`, `catservice`, `api.example.com`, `dummy-token` 같은 generic name만 사용한다.

## 오류 처리

- target을 찾지 못하면 `clip list` hint가 포함된 안정적인 CLI error를 반환한다.
- 알 수 없는 target type은 adapter registration error를 반환한다.
- invalid config는 target name과 config path를 보고한다.
- ACL denial은 adapter failure와 구분된다.
- adapter failure는 가능한 경우 exit code를 보존한다.
- validation failure는 structured JSON으로 render 가능해야 한다.
- hook failure는 hook이 best-effort로 표시되지 않은 한 invocation을 실패시켜야 한다.

## 테스트

Unit test:

- temporary home을 사용한 store load/save.
- 여러 type에 걸친 target resolution.
- profile merge precedence.
- alias expansion.
- ACL allow/deny decision.
- adapter detection order.
- add/list/remove/login/logout/profile/alias command parsing.
- fake adapter를 사용한 runtime dispatch.
- plain/JSON output selection.

Integration test:

- CLI target을 등록하고 harmless command 실행.
- OpenAPI target fixture를 등록하고 `tools`와 operation 하나 실행.
- MCP fixture를 등록하고 `tools` 실행.
- `clip <target>@<profile> ...` 검증.
- `clip <target> describe ...` 검증.

## 도입 계획

1. `@clip/config`를 추가한다.
2. store와 fake adapter test를 포함한 `@clip/cli-gateway`를 추가한다.
3. 현재 middleware API로 unmatched target invocation을 깔끔하게 routing할 수 없다면 core fallback support를 추가한다.
4. CLI target support를 먼저 port한다.
5. add/list/remove/profile/alias command를 추가한다.
6. MCP adapter를 port한다.
7. OpenAPI, GraphQL, gRPC, script adapter를 port한다.
8. auth와 adapter refresh contract가 안정되면 login/logout과 refresh를 추가한다.
9. `clip` app을 `@clip/core`, renderer, `@clip/config`, `@clip/cli-gateway` 조합으로 다시 연결한다.

## 검토 메모

이 패키지는 runtime, adapter, target command를 의도적으로 함께 묶는다. 세 영역이 모두 하나의 제품 기능인 CLI gateway target system을 제공하기 때문이다. 대신 내부 folder boundary를 강하게 유지해서 과도한 package fragmentation 없이 코드 이해 가능성을 확보한다.
