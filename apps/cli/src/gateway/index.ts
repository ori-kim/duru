import { createSecretsOAuthTokenStore, parseOAuthBackendConfig } from "@duru/auth";
import { cliGateway, createGatewayCli, defaultGatewayAdapters, loadGatewaySnapshot } from "@duru/cli-gateway";
import { createDuruFileHome } from "@duru/file-store";
import type { Manifest, SecretResolver } from "@duru/secrets";
import { createAppOAuthGatewayService } from "../auth/oauth-services.ts";
import { withGatewayCatalogCache } from "./catalog-store.ts";
import { createAppGatewayEnvService } from "./env-service.ts";
import { createAppGatewayStore } from "./store.ts";

export type CreateAppGatewayOptions = {
  env?: Readonly<Record<string, string | undefined>>;
  routeName?: string;
  manifest: Manifest;
  resolver: SecretResolver;
};

const gatewayGroup = "Gateway";

export async function createAppGateway(options: CreateAppGatewayOptions) {
  const env = options.env ?? process.env;
  const routeName = options.routeName ?? "gateway";
  const fileHome = createDuruFileHome({ env });
  const gatewayFiles = fileHome.store("gateway");
  const gatewayStore = withGatewayCatalogCache(
    createAppGatewayStore({ files: gatewayFiles, shims: fileHome.store("bin") }),
    gatewayFiles,
  );

  const oauthConfig = parseOAuthBackendConfig(options.manifest.data);
  const oauthTokenStore = createSecretsOAuthTokenStore(options.resolver, oauthConfig);

  const baseGatewayOptions = {
    store: gatewayStore,
    adapters: defaultGatewayAdapters(),
    env,
    services: {
      oauth: createAppOAuthGatewayService({ tokens: oauthTokenStore }),
      env: createAppGatewayEnvService({ fileHome }),
      secrets: options.resolver,
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
