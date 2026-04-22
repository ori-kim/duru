/**
 * core-type-bundle.ts — gen-core-types.ts가 생성한 bundle을 re-export.
 *
 * 빌드 전에 `bun scripts/gen-core-types.ts` 를 실행해야 한다.
 * generated 파일은 .gitignore 대상이며 바이너리에 직접 번들된다.
 */
export type { CoreTypeFile } from "./core-type-bundle.generated.ts";
export { getCoreTypeFiles } from "./core-type-bundle.generated.ts";
