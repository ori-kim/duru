/**
 * apps/clip-minimal/src/main.ts — 최소 조립 시나리오 검증용
 *
 * @clip/core + @clip/protocol-mcp 만으로 Registry를 조립한다.
 * Step 5 완료 조건 검증용.
 */
import { Registry } from "@clip/core";
import { extension as mcpExt } from "@clip/protocol-mcp";

const registry = new Registry();
registry.register(mcpExt);

console.log("Registry assembled with MCP extension:", mcpExt.name);
