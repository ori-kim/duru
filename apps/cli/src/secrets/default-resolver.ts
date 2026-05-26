import { FileProvider, type SecretProvider, type SecretResolver, createResolver } from "@duru/secrets";
import { KeychainProvider, isMacOS } from "@duru/secrets-keychain";

export function buildDefaultResolver(): SecretResolver {
  const providers: SecretProvider[] = [new FileProvider()];
  if (isMacOS()) providers.push(new KeychainProvider());
  return createResolver(providers);
}
