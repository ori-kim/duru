import { cliGateway, createGatewayCli, defaultGatewayAdapters, loadGatewaySnapshot } from "@duru/cli-gateway";
import { createDuruFileHome } from "@duru/file-store";
import { createConfiguredOAuthTokenStore } from "../auth/configured-token-store.ts";
import { createTargetFileOAuthTokenStore } from "../auth/file-token-store.ts";
import { createMacOSKeychainOAuthTokenStore } from "../auth/keychain-store.ts";
import { createAppOAuthGatewayService } from "../auth/oauth-services.ts";
import { withGatewayCatalogCache } from "./catalog-store.ts";
import { createAppGatewayEnvService } from "./env-service.ts";
import { createAppGatewayStore } from "./store.ts";

export type CreateAppGatewayOptions = {
  env?: Readonly<Record<string, string | undefined>>;
  routeName?: string;
};

const gatewayGroup = "Gateway";

export async function createAppGateway(options: CreateAppGatewayOptions = {}) {
  const env = options.env ?? process.env;
  const routeName = options.routeName ?? "gateway";
  const fileHome = createDuruFileHome({ env });
  const gatewayFiles = fileHome.store("gateway");
  const gatewayStore = withGatewayCatalogCache(
    createAppGatewayStore({ files: gatewayFiles, shims: fileHome.store("bin") }),
    gatewayFiles,
  );
  const oauthTokenStore = createConfiguredOAuthTokenStore({
    targets: gatewayStore,
    keychain: createMacOSKeychainOAuthTokenStore(),
    file: createTargetFileOAuthTokenStore({ files: gatewayFiles, targets: gatewayStore }),
  });
  const baseGatewayOptions = {
    store: gatewayStore,
    adapters: defaultGatewayAdapters(),
    env,
    services: {
      oauth: createAppOAuthGatewayService({ tokens: oauthTokenStore }),
      env: createAppGatewayEnvService({ fileHome }),
    },
  };
  const gatewayOptions = {
    ...baseGatewayOptions,
    snapshot: await loadGatewaySnapshot(baseGatewayOptions),
  };

  return {
    routeName,
    cli: createGatewayCli(gatewayOptions, { group: gatewayGroup }),
    plugin: cliGateway(gatewayOptions, { namespace: routeName, group: gatewayGroup }),
    store: gatewayStore,
  };
}
