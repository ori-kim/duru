import type { Awaitable, Cli } from "@duru/cli-kit";

const virtualPluginTag = Symbol.for("duru.virtual_plugin");

export type VirtualPluginInstaller = (cli: Cli) => Awaitable<unknown>;

export type VirtualPlugin = {
  readonly kind: "duru.virtual_plugin";
  readonly [virtualPluginTag]: true;
  install(cli: Cli): Awaitable<void>;
};

export function virtualPlugin(install: VirtualPluginInstaller): VirtualPlugin {
  return {
    kind: "duru.virtual_plugin",
    [virtualPluginTag]: true,
    async install(cli) {
      await install(cli);
    },
  };
}

export function isVirtualPlugin(value: unknown): value is VirtualPlugin {
  return typeof value === "object" && value !== null && virtualPluginTag in value;
}
