# @clip/file-store 설계

날짜: 2026-05-22
상태: 검토용 초안

## 목적

`@clip/file-store`는 Clip 패키지와 app이 공통으로 사용할 홈 디렉터리, 디렉터리 레이아웃, 안전한 path 처리, 파일 read/write primitive를 제공한다. 이 패키지는 target, profile, protocol adapter, command, plugin manifest, auth, gateway 의미를 알지 않는다.

이름은 `config`가 아니라 `file-store`로 둔다. 이 패키지가 제공하는 것은 config domain이 아니라 파일 저장소 primitive다. target config schema, plugin manifest schema, gateway store semantics는 각각 해당 패키지나 app이 소유한다.

## 목표

- 명시 옵션, `CLIP_HOME`, 기본 홈 디렉터리 순서로 실제 Clip home을 결정한다.
- 각 패키지가 중앙 도메인 schema 없이 자기 레이아웃을 소유할 수 있도록 scoped store를 제공한다.
- store 상대 경로에서 path traversal과 절대 경로를 거부하는 안전한 path helper를 제공한다.
- text, binary, directory listing, existence check, remove를 위한 기본 file helper를 제공한다.
- JSON, YAML, TOML 같은 structured format은 codec adapter로 제공한다.
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
- file IO primitive 이상의 secret storage 정책을 제공하지 않는다.

## 개념

### ClipFileHome

`ClipFileHome`은 Clip state의 resolved root directory를 나타낸다.

```ts
type ClipFileHome = {
  root: string;
  resolve(path?: string): string;
  scope(name: string): FileStore;
  store(path?: string): FileStore;
};
```

`scope(name)`은 `root/name` 아래 namespaced store를 만든다. `store(path)`는 root 아래의 안전한 상대 경로에 store를 만든다. 이 구조 덕분에 app은 `gateway/cli/test-service` 같은 gateway layout도, `plugins/example/manifest.toml` 같은 새 layout도 직접 선택할 수 있다.

### FileStore

`FileStore`는 특정 디렉터리를 root로 삼는 파일시스템 helper다.

```ts
type FileStore = {
  root: string;
  resolve(path?: string): string;
  scope(name: string): FileStore;
  ensureDir(path?: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  list(path?: string): Promise<readonly FileStoreDirEntry[]>;
  readText(path: string): Promise<string | undefined>;
  writeText(path: string, value: string, options?: WriteOptions): Promise<void>;
  readBytes(path: string): Promise<Uint8Array | undefined>;
  writeBytes(path: string, value: Uint8Array, options?: WriteOptions): Promise<void>;
  read<T = unknown>(path: string, options?: ReadStructuredOptions): Promise<T | undefined>;
  write(path: string, value: unknown, options?: WriteStructuredOptions): Promise<void>;
  readAs<T = unknown>(path: string, codec: string): Promise<T | undefined>;
  writeAs(path: string, value: unknown, codec: string): Promise<void>;
  remove(path: string, options?: RemoveOptions): Promise<void>;
};
```

파일이 없으면 read helper는 `undefined`를 반환한다. parse error에는 resolved path와 codec id가 포함되어야 한다. write helper는 parent directory를 자동 생성한다.

### FileCodec

Structured format은 codec으로 분리한다.

```ts
type FileCodec<T = unknown> = {
  id: string;
  extensions: readonly string[];
  parse(text: string, ctx: FileCodecContext): T;
  stringify(value: T, ctx: FileCodecContext): string;
};
```

기본 codec:

- `jsonCodec()` for `.json`.
- `yamlCodec()` for `.yaml` and `.yml`.
- `tomlCodec()` for `.toml`.

`read(path)`와 `write(path, value)`는 path extension으로 codec을 고른다. `readAs()`와 `writeAs()`는 extension과 무관하게 codec id를 명시한다. 첫 버전에서는 같은 basename의 `.toml`, `.yml`, `.json` 중 자동 탐색하는 동작을 기본으로 넣지 않는다. 필요하면 app이 `readFirst(["config.toml", "config.yml", "config.json"])` 같은 helper를 자체 구현하거나, 나중에 명시 API로 추가한다.

## 공개 API

```ts
type CreateClipFileHomeOptions = {
  home?: string;
  env?: Readonly<Record<string, string | undefined>>;
  defaultHome?: string;
  codecs?: readonly FileCodec[];
};

type CreateFileStoreOptions = {
  root: string;
  codecs?: readonly FileCodec[];
};

declare function createClipFileHome(options?: CreateClipFileHomeOptions): ClipFileHome;
declare function createFileStore(options: CreateFileStoreOptions): FileStore;
declare function assertSafeStorePath(path: string): void;
declare function jsonCodec(): FileCodec;
declare function yamlCodec(): FileCodec;
declare function tomlCodec(): FileCodec;
```

우선순위는 `home` > `env.CLIP_HOME` > `defaultHome`이다. `defaultHome`의 기본값은 사용자 홈 아래 `.clip`이다. 기본 codec set은 JSON/YAML/TOML을 포함할 수 있지만, dependency weight가 문제가 되면 app이 codecs를 명시 주입하는 방식으로 줄일 수 있다.

패키지는 다음 error도 export할 수 있다.

```ts
class ClipFileStorePathError extends Error {}
class ClipFileStoreParseError extends Error {}
class ClipFileStoreWriteError extends Error {}
class ClipFileStoreCodecError extends Error {}
```

## 레이아웃 정책

`@clip/file-store`는 대부분의 directory name을 예약하지 않는다. 이 패키지는 path 동작만 정의한다.

권장 ownership:

- `gateway/`: `apps/clip`의 file-backed `GatewayStore` 구현이 소유할 수 있다.
- `plugins/` 또는 `extensions/`: app plugin manager package가 소유한다.
- `cache/`: 각 패키지가 scoped cache subdirectory를 만들 수 있다.
- `state/`: 각 패키지가 scoped state subdirectory를 만들 수 있다.

현재 gateway 설정은 `apps/clip`이 `$CLIP_HOME/gateway` 아래에 저장한다.

```text
$CLIP_HOME/gateway/<type>/<name>/config.yml
$CLIP_HOME/gateway/<type>/<name>/.env
```

이 호환성 결정은 `@clip/file-store`나 `@clip/cli-gateway`가 아니라 `apps/clip`의 file-backed gateway store 구현 책임이다.

## 사용 예시

```ts
import { createClipFileHome, jsonCodec, tomlCodec, yamlCodec } from "@clip/file-store";

const home = createClipFileHome({
  env: process.env,
  codecs: [jsonCodec(), yamlCodec(), tomlCodec()],
});

const gatewayFiles = home.store("gateway");

await gatewayFiles.write("cli/test-service/config.yml", {
  command: "test-service",
  timeoutMs: 30000,
});

const target = await gatewayFiles.read("cli/test-service/config.yml");
```

## 오류 처리

- 안전하지 않은 path는 파일시스템에 접근하기 전에 throw한다.
- read helper는 파일이 없을 때만 `undefined`를 반환한다.
- extension에 맞는 codec이 없으면 `ClipFileStoreCodecError`를 throw한다.
- parse failure는 `ClipFileStoreParseError`를 throw한다.
- write는 temp file을 쓴 뒤 rename한다.
- 실패한 write는 destination file을 partial 상태로 남기면 안 된다.
- remove는 기본적으로 file-only 동작이며, recursive removal은 명시적으로 요청해야 한다.

## 테스트

Unit test가 다뤄야 할 항목:

- home resolution 우선순위.
- 절대 경로, `..`, 비어 있는 invalid segment 거부.
- missing file read.
- JSON/YAML/TOML round trip.
- extension 기반 codec 선택.
- 명시 codec 기반 `readAs`/`writeAs`.
- parent directory 생성.
- API 수준의 atomic write 동작.
- scoped store path resolution.
- temporary test home을 사용한 deterministic behavior.

## 도입 계획

1. path/file-store primitive와 codec contract를 포함한 `@clip/file-store`를 추가한다.
2. JSON/YAML/TOML codec을 제공한다.
3. 새 패키지들은 `CLIP_HOME`을 직접 읽지 않고 `createClipFileHome()`을 사용하게 한다.
4. 기존 제품 layout은 app 또는 feature package가 소유하게 둔다.
5. migration helper는 실제 도메인 패키지에서 구체적인 migration 필요가 생겼을 때 추가한다.

## 열린 결정

- 기본 codec을 항상 포함할지, app이 명시 주입하게 할지는 dependency 크기와 사용성 사이의 trade-off다.
- package split이 필요하면 codec을 `@clip/file-store/codecs` subpath로 뺄 수 있다.
- 첫 버전에는 file locking을 넣지 않는다. 현재 local CLI workflow에는 atomic write로 충분하다.
