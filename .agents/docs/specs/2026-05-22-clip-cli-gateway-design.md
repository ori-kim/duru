# @clip/cli-gateway 설계

날짜: 2026-05-22
상태: 검토용 초안

## 목적

`@clip/cli-gateway`는 Clip의 target gateway 기능을 소유하는 패키지다. target manifest 평가, protocol adapter, target-facing command를 하나의 installable CLI plugin으로 묶는다.

이 패키지가 필요한 이유는 target system이 generic CLI framework 관심사가 아니기 때문이다. target system은 외부 tool/protocol을 등록하고, policy를 적용하고, invocation을 routing하고, `add`, `list`, `remove`, `login`, `logout`, `profile` 같은 관리 command를 노출하는 제품 기능이다.

Gateway는 persistence 구현을 직접 소유하지 않는다. file-backed store, in-memory store, 다른 저장소 구현은 모두 `GatewayStore` interface를 만족하는 app-level 조립 문제다.

## 목표

- `@clip/core`의 CLI framework에 설치할 수 있는 `cliGateway()` plugin을 제공한다.
- target gateway command를 소유한다: add, list, remove, refresh, login, logout, profile, alias, bind, unbind, binds.
- target invocation routing을 소유한다: `clip <target> <subcommand> [...args]`.
- 저장된 target manifest를 adapter별 `GatewayTarget` 객체로 통합한다.
- CLI, MCP, OpenAPI REST, GraphQL, gRPC, script target을 위한 기본 adapter를 포함한다.
- persistence 구현을 직접 import하지 않고 `GatewayStore` interface만 사용한다.
- 테스트와 개발을 위한 in-memory `GatewayStore` 구현을 제공할 수 있다.
- 나중에 외부 adapter를 붙일 수 있도록 안정적인 adapter interface를 제공한다.

## 비목표

- app update command는 포함하지 않는다. `clip update`는 distribution-level behavior다.
- 일반 app plugin installer는 포함하지 않는다. Extension installation은 plugin platform package 책임이다.
- skills registry는 포함하지 않는다. Skills는 별도의 제품 기능이다.
- secure token backend는 이 패키지에 포함하지 않는다.
- `@clip/core`에 있어야 할 broad framework API를 제공하지 않는다.
- `@clip/file-store`에 직접 의존하지 않는다.
- legacy target file layout과 format 선택을 직접 소유하지 않는다.

## 패키지 형태

```text
packages/cli-gateway/
  src/{index,plugin,types}.ts
  src/{runtime,store,commands,output}/
  src/adapters/{cli,mcp,openapi,graphql,grpc,script}/
```

기본 public surface:

```ts
import { cliGateway, defaultGatewayAdapters } from "@clip/cli-gateway";

createCli({ name: "clip" }).use(
  cliGateway({
    store,
    adapters: defaultGatewayAdapters(),
  }),
);
```

## App 조립

`apps/clip`은 `@clip/file-store`를 사용해 `GatewayStore` interface를 구현하고, 그 구현을 gateway에 주입한다.

```ts
const files = createClipFileHome({ env: process.env });
const store: GatewayStore = createAppGatewayStore({
  files: files.store("target"),
  format: "yaml",
});

createCli({ name: "clip" }).use(cliGateway({ store, adapters }));
```

`createAppGatewayStore`는 별도 package가 아니라 `apps/clip` 내부 glue code다. 이 파일만 `@clip/file-store`와 `@clip/cli-gateway`를 동시에 알고, 두 package는 서로 직접 의존하지 않는다.

## Store Interface

Gateway는 target-system data를 `GatewayStore` interface를 통해서만 읽고 쓴다.

```ts
type GatewayStore = {
  listTargets(): Promise<readonly GatewayTargetRecord[]>;
  getTarget(name: string): Promise<GatewayTargetRecord | undefined>;
  saveTarget(record: GatewayTargetRecord): Promise<void>;
  removeTarget(name: string): Promise<void>;
  listProfiles(target: string): Promise<readonly GatewayProfileRecord[]>;
  getProfile(target: string, name: string): Promise<GatewayProfileRecord | undefined>;
  saveProfile(target: string, profile: GatewayProfileRecord): Promise<void>;
  removeProfile(target: string, name: string): Promise<void>;
  listAliases(target: string): Promise<readonly GatewayAliasRecord[]>;
  saveAlias(target: string, alias: GatewayAliasRecord): Promise<void>;
  removeAlias(target: string, name: string): Promise<void>;
};
```

책임:

- target record load/save.
- 여러 type에 걸친 target name resolution.
- profile 관리.
- alias 관리.
- bind metadata가 target system에 속한다면 bind metadata 관리.

`apps/clip`의 file-backed 구현은 기존 호환 layout을 유지할 수 있다.

```text
$CLIP_HOME/target/<type>/<name>/config.yml
$CLIP_HOME/target/<type>/<name>/.env
```

이 layout은 gateway contract가 아니라 app store 구현 세부사항이다.

## Gateway Context

`GatewayContext`는 gateway 인스턴스가 공유하는 실행 환경이다. target 실행 객체가 무엇을 할 수 있는지를 뜻하지 않고, target을 만들고 실행할 때 사용할 공통 서비스와 정책을 뜻한다.

```ts
type GatewayContext = {
  store: GatewayStore;
  env?: Readonly<Record<string, string | undefined>>;
  services?: GatewayServices;
  output?: GatewayOutputOptions;
};
```

첫 버전의 `services`는 credential store, keychain wrapper, logger, network/process host adapter 같은 app-level 의존성을 주입하기 위한 확장 지점이다. `@clip/cli-gateway`는 credential 저장 방식이나 host 구현을 직접 소유하지 않는다.

## Gateway Target

`GatewayTarget`은 gateway가 CLI/runtime에 연결할 수 있는 실행 가능한 target 객체다. 이 객체는 store에 저장된 원본이 아니라, manifest와 profile을 resolve하고 adapter가 config를 검증한 뒤 만든 결과다.

```ts
type GatewayTarget<TConfig = unknown> = {
  name: string;
  type: string;
  config: TConfig;
  profile?: string;
  invoke(ctx: GatewayInvokeContext): Promise<GatewayResult>;
  catalog?(ctx: GatewayCatalogContext): Promise<readonly GatewayTool[] | null>;
  refresh?(ctx: GatewayRefreshContext): Promise<GatewayTargetRefreshResult<TConfig> | undefined>;
  auth?: GatewayTargetAuth;
  listRow?(): GatewayListRow | Promise<GatewayListRow>;
  complete?(ctx: GatewayCompletionContext): Promise<readonly CompletionItem[]>;
};
```

책임:

- target invocation parse.
- target과 optional profile resolve.
- target alias expansion.
- ACL과 command policy 적용.
- manifest를 `GatewayTarget`으로 변환.
- `GatewayTarget` method 실행.
- timeout과 abort signal 적용.
- `GatewayResult` 반환.
- output을 render하거나 configured renderer에 넘김.

Gateway는 파일을 직접 읽거나 쓰지 않는다. `GatewayStore` interface를 사용한다.

## Adapters

Adapter는 target type별 manifest 해석과 `GatewayTarget` 생성을 구현한다.

```ts
type GatewayAdapter<TConfig = unknown> = {
  type: string;
  schema: GatewaySchema<TConfig>;
  detect?(input: AddInput): boolean | Promise<boolean>;
  add?(input: AddInput): Promise<TConfig>;
  normalize?(config: TConfig, ctx: NormalizeContext): TConfig | Promise<TConfig>;
  createTarget(input: GatewayTargetCreateInput<TConfig>): GatewayTarget<TConfig>;
};
```

`execute`, `refresh`, `login`, `logout`, `complete` 같은 동작은 adapter 자체의 method가 아니라 adapter가 만든 `GatewayTarget`의 method다. 이렇게 나누면 gateway는 공통 resolve/auth/policy/timeout/store 처리를 유지하면서, target type별 실행 의미만 adapter에 위임할 수 있다.

기본 adapter:
- `cli`: local CLI execution과 passthrough.
- `mcp`: HTTP, SSE, stdio MCP server.
- `openapi`: OpenAPI REST operation discovery와 execution.
- `graphql`: introspection, query, mutation execution.
- `grpc`: protobuf 또는 reflection 기반 service call.
- `script`: target으로 저장된 named script.

## Commands

Gateway command는 target system을 위한 product command다.

포함:

- `clip add/list/remove/refresh/login/logout ...`
- `clip profile add/use/list/remove/unset ...`
- `clip alias add/list/remove ...`
- `clip bind/unbind/binds ...`

Target subcommand는 runtime이 routing한다.

- `clip <target> tools`
- `clip <target> describe <operation>`
- `clip <target> types`
- `clip <target> <operation> [...args]`

패키지 밖에 두는 command:

- `clip update`, `clip ext ...`, `clip skills ...`

`completion`은 별도 shell-specific plugin이 소유한다. `@clip/cli-gateway`는 target, profile, alias, adapter operation을 위한 shell-neutral completion contributor만 제공한다.

## 공개 API

```ts
type CliGatewayOptions = {
  store: GatewayStore;
  adapters?: readonly GatewayAdapter[];
  env?: Readonly<Record<string, string | undefined>>;
  services?: GatewayServices;
  output?: GatewayOutputOptions;
};

declare function cliGateway(options: CliGatewayOptions): CliPlugin;
declare function defaultGatewayAdapters(): readonly GatewayAdapter[];
declare function createMemoryGatewayStore(seed?: GatewayStoreSeed): GatewayStore;
```

Adapter authoring type은 공개한다.

```ts
export type {
  GatewayAdapter,
  GatewayContext,
  GatewayTarget,
  GatewayResult,
  GatewayTool,
  GatewayStore,
  GatewayTargetRecord,
  GatewayProfileRecord,
  GatewayAliasRecord,
  AddInput,
  GatewayInvokeContext,
  GatewayAuthContext,
};
```

## Core 통합

`@clip/cli-gateway`는 일반 command가 match되지 않은 뒤 target invocation을 실행할 방법이 필요하다. 가능한 통합 방식은 두 가지다.

1. plugin이 unmatched argv에 대해 register할 수 있는 core fallback hook을 추가한다.
2. gateway가 terminal middleware를 설치하고 route handled 여부를 관찰한다.

fallback hook이 권장안이다. target routing은 일반 literal command가 아니기 때문이다.

## Invocation Flow

```text
argv
  -> core parses global options
  -> gateway fallback receives unmatched argv
  -> gateway parser identifies target token and profile
  -> GatewayStore returns target record
  -> gateway expands aliases
  -> gateway merges active and explicit profile records
  -> gateway checks ACL/policy/auth requirements
  -> adapter validates config and creates GatewayTarget
  -> gateway calls GatewayTarget.invoke()
  -> output renderer writes result
```

예를 들어 `clip test-service getItem --id 1 --json`은 `test-service`를 resolve하고, 해당 adapter를 선택하고, `getItem`을 실행한 뒤 JSON으로 render한다.

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

`GatewayTargetRecord`는 target name, type, adapter config, source metadata를 감싼다. App의 file-backed store는 YAML/TOML/JSON 중 어떤 format을 쓰든 이 record로 변환해서 gateway에 넘긴다.

## 오류 처리

- target 없음, 알 수 없는 target type, invalid target record는 안정적인 CLI error로 구분한다.
- ACL denial, validation failure, adapter failure는 서로 다른 error code로 표현한다.
- adapter failure는 가능한 경우 exit code를 보존한다.
- hook failure는 hook이 best-effort로 표시되지 않은 한 invocation을 실패시킨다.

## 테스트

Unit test:

- memory store를 사용한 store load/save.
- 여러 type에 걸친 target resolution.
- profile merge precedence.
- alias expansion.
- ACL allow/deny decision.
- adapter detection order.
- add/list/remove/login/logout/profile/alias command parsing.
- fake adapter를 사용한 runtime dispatch.
- app-level file-backed store가 legacy layout을 `GatewayStore` record로 변환하는지 검증.
- plain/JSON output selection.

Integration test:

- CLI target을 등록하고 harmless command 실행.
- OpenAPI와 MCP fixture를 등록하고 `tools`와 operation 실행.
- `clip <target>@<profile> ...` 검증.
- `clip <target> describe ...` 검증.

## 도입 계획

1. `GatewayStore` interface와 memory store를 포함한 `@clip/cli-gateway`를 추가한다.
2. 현재 middleware API로 unmatched target invocation을 깔끔하게 routing할 수 없다면 core fallback support를 추가한다.
3. `apps/clip`에서 `@clip/file-store` 기반 file-backed `GatewayStore` 구현을 작성한다.
4. CLI target support를 먼저 port한다.
5. add/list/remove/profile/alias command를 추가한다.
6. MCP adapter를 port한다.
7. OpenAPI, GraphQL, gRPC, script adapter를 port한다.
8. auth와 adapter refresh contract가 안정되면 login/logout과 refresh를 추가한다.
9. `clip` app을 `@clip/core`, renderer, app-owned `GatewayStore`, `@clip/cli-gateway` 조합으로 다시 연결한다.

## 검토 메모

이 패키지는 runtime, adapter, target command를 의도적으로 함께 묶는다. 세 영역이 모두 하나의 제품 기능인 CLI gateway target system을 제공하기 때문이다. 대신 persistence는 app이 `GatewayStore` interface에 맞춰 명시적으로 조립한다.
