/**
 * virtual-modules.ts — 바이너리 내부 모듈을 외부 user extension에서 import 가능하게 주입.
 *
 * standalone binary(bun build --compile)에서 dynamic import된 외부 .ts 파일이
 * `import { die } from "@clip/core"` 같은 구문을 쓸 때, 파일시스템에서 resolve하지 않고
 * 바이너리 내부에 번들된 동일 인스턴스를 반환한다.
 *
 * zod, yaml도 포함 — extension이 core schema fragment를 .extend()로 합성하므로
 * zod 인스턴스 identity를 바이너리와 extension이 공유해야 한다.
 *
 * main.ts에서 최상단 import로 두어야 한다. ESM import order에 의해 다른 모든 모듈보다
 * 먼저 side-effect(Bun.plugin 등록)가 실행된다.
 */
import * as clipCore from "@clip/core";
import * as zodMod from "zod";
import * as yamlMod from "yaml";

Bun.plugin({
  name: "clip-virtual-modules",
  setup(build) {
    const register = (specifier: string, mod: unknown) => {
      build.module(specifier, () => ({
        exports: mod as Record<string, unknown>,
        loader: "object",
      }));
    };
    register("@clip/core", clipCore);
    register("zod", zodMod);
    register("yaml", yamlMod);
  },
});
