# @clip/config 설계

날짜: 2026-05-22
상태: 검토용 초안

## 목적

`@clip/config`는 Clip 패키지들이 공통으로 사용할 홈 디렉터리, 디렉터리 레이아웃, 파일 저장소 primitive를 제공한다. 이 패키지는 target, profile, protocol adapter, command, plugin manifest, auth, gateway 의미를 알지 않는다. 각 도메인 패키지는 이 패키지를 사용해 Clip home 아래에 자기 파일을 일관되게 배치하고 읽고 쓴다.

이 패키지는 의도적으로 단순해야 한다. 여러 기능이 `CLIP_HOME` 해석, 디렉터리 생성, 안전한 상대 경로 처리, 구조화된 파일 IO, atomic write를 반복 구현하지 않게 해주는 공유 파일시스템 기반이다.

## 목표

- 명시 옵션, `CLIP_HOME`, 기본 홈 디렉터리 순서로 실제 Clip home을 결정한다.
- 각 패키지가 중앙 도메인 schema 없이 자기 레이아웃을 소유할 수 있도록 scoped store를 제공한다.
- store 상대 경로가 필요한 곳에서 path traversal과 절대 경로를 거부하는 안전한 path helper를 제공한다.
- text, JSON, YAML, binary, directory listing, existence check, remove를 위한 작은 read/write helper를 제공한다.
- config/state 파일은 partial write를 피하기 위해 atomic write를 사용한다.
- 명시 home path와 env object를 받을 수 있게 해서 테스트를 결정적으로 만든다.
- target config, plugin manifest, auth token, profile, command 의미를 이 패키지 밖에 둔다.

## 비목표

- target registry 또는 target config schema를 제공하지 않는다.
- plugin/extension manifest schema를 제공하지 않는다.
- command 등록 기능을 제공하지 않는다.
- protocol 실행을 제공하지 않는다.
- auth flow 또는 token refresh를 제공하지 않는다.
- 첫 버전에서는 전역 migration framework를 제공하지 않는다.
- file IO primitive 이상의 secret storage 정책을 제공하지 않는다. token을 다루는 패키지는 자체적으로 안전한 저장 방식을 선택해야 한다.

## 개념

### ClipHome

`ClipHome`은 Clip state의 resolved root directory를 나타낸다.

```ts
type ClipHome = {
  root: string;
  resolve(path?: string): string;
  scope(name: string): ClipStore;
  store(path?: string): ClipStore;
};
```

`resolve()`는 home root 아래의 경로를 반환한다. `scope(name)`은 `root/name` 아래 namespaced store를 만든다. `store(path)`는 root 아래의 안전한 상대 경로에 store를 만든다. 이 구조 덕분에 도메인 패키지는 `cli-gateway/targets` 같은 namespaced layout을 쓸 수도 있고, `target/cli/test-service` 같은 호환 layout을 쓸 수도 있다.

### ClipStore

`ClipStore`는 특정 디렉터리를 root로 삼는 파일시스템 helper다.

```ts
type ClipStore = {
  root: string;
  resolve(path?: string): string;
  ensureDir(path?: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  list(path?: string): Promise<readonly ClipDirEntry[]>;
  readText(path: string): Promise<string | undefined>;
  writeText(path: string, value: string, options?: WriteOptions): Promise<void>;
  readJson<T = unknown>(path: string): Promise<T | undefined>;
  writeJson(path: string, value: unknown, options?: WriteOptions): Promise<void>;
  readYaml<T = unknown>(path: string): Promise<T | undefined>;
  writeYaml(path: string, value: unknown, options?: WriteOptions): Promise<void>;
  readBytes(path: string): Promise<Uint8Array | undefined>;
  writeBytes(path: string, value: Uint8Array, options?: WriteOptions): Promise<void>;
  remove(path: string, options?: RemoveOptions): Promise<void>;
};
```

파일이 없으면 read helper는 `undefined`를 반환한다. parse error에는 resolved path와 parser 이름이 포함되어야 한다. write helper는 parent directory를 자동 생성한다.

## 공개 API

```ts
type CreateClipHomeOptions = {
  home?: string;
  env?: Readonly<Record<string, string | undefined>>;
  defaultHome?: string;
};

declare function createClipHome(options?: CreateClipHomeOptions): ClipHome;
declare function createClipStore(root: string): ClipStore;
declare function assertSafeStorePath(path: string): void;
```

우선순위는 `home` > `env.CLIP_HOME` > `defaultHome`이다. `defaultHome`의 기본값은 사용자 홈 아래 `.clip`이다.

패키지는 다음 error도 export할 수 있다.

```ts
class ClipConfigPathError extends Error {}
class ClipConfigParseError extends Error {}
class ClipConfigWriteError extends Error {}
```

## 레이아웃 정책

`@clip/config`는 대부분의 directory name을 예약하지 않는다. 이 패키지는 path 동작만 정의한다.

권장 ownership:

- `cli-gateway/` 또는 `target/`: `@clip/cli-gateway`가 소유한다.
- `plugins/` 또는 `extensions/`: app plugin manager package가 소유한다.
- `cache/`: 각 패키지가 scoped cache subdirectory를 만들 수 있다.
- `state/`: 각 패키지가 scoped state subdirectory를 만들 수 있다.

현재 제품과의 호환을 위해 `@clip/cli-gateway`는 기존 target path를 유지할 수 있다.

```text
$CLIP_HOME/target/<type>/<name>/config.yml
$CLIP_HOME/target/<type>/<name>/.env
```

이 호환성 결정은 `@clip/config`가 아니라 `@clip/cli-gateway`의 책임이다.

## 사용 예시

```ts
import { createClipHome } from "@clip/config";

const home = createClipHome({ env: process.env });
const gatewayStore = home.store("target");

await gatewayStore.writeYaml("cli/test-service/config.yml", {
  command: "test-service",
  timeoutMs: 30000,
});

const target = await gatewayStore.readYaml("cli/test-service/config.yml");
```

## 오류 처리

- 안전하지 않은 path는 파일시스템에 접근하기 전에 throw한다.
- read helper는 파일이 없을 때만 `undefined`를 반환한다.
- parse failure는 `ClipConfigParseError`를 throw한다.
- write는 temp file을 쓴 뒤 rename한다. 실패한 write는 destination file을 partial 상태로 남기면 안 된다.
- remove는 기본적으로 file-only 동작이며, recursive removal은 명시적으로 요청해야 한다.

## 테스트

Unit test가 다뤄야 할 항목:

- home resolution 우선순위.
- 절대 경로, `..`, 비어 있는 invalid segment 거부.
- missing file read.
- JSON/YAML round trip.
- parent directory 생성.
- API 수준의 atomic write 동작.
- scoped store path resolution.
- temporary test home을 사용한 deterministic behavior.

## 도입 계획

1. path/file-store primitive만 포함한 `@clip/config`를 추가한다.
2. 새 패키지들은 `CLIP_HOME`을 직접 읽지 않고 `createClipHome()`을 사용하게 한다.
3. 기존 제품 layout은 각 feature package가 소유하게 둔다.
4. migration helper는 실제 도메인 패키지에서 구체적인 migration 필요가 생겼을 때 추가한다.

## 열린 결정

- 기존 제품이 YAML을 많이 사용하므로 YAML support는 built-in으로 둘 수 있다. dependency weight가 문제가 되면 나중에 codec registration API 뒤로 옮길 수 있다.
- 첫 버전에는 file locking을 넣지 않는다. 현재 local CLI workflow에는 atomic write로 충분하다.
