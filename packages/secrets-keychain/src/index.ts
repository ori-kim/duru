import { join } from "node:path";
import { ProviderUnavailable, type SecretProvider, type SetInstructions } from "@duru/secrets";
import { type KeychainIndex, createKeychainIndex } from "./index-file.ts";
import { openPasswordsApp } from "./open-passwords-app.ts";
import { isMacOS } from "./platform.ts";
import { addGenericPassword, deleteGenericPassword, findGenericPassword } from "./security-cli.ts";

export interface KeychainProviderOptions {
  service?: string;
  indexPath?: string;
}

const DEFAULT_SERVICE = "duru.secrets";

function defaultIndexPath(): string {
  const home = process.env.DURU_HOME ?? join(process.env.HOME ?? ".", ".duru");
  return join(home, ".cache", "keychain-index.json");
}

export class KeychainProvider implements SecretProvider {
  readonly scheme = "keychain";
  private readonly service: string;
  private readonly index: KeychainIndex;

  constructor(opts: KeychainProviderOptions = {}) {
    if (!isMacOS()) {
      throw new ProviderUnavailable("keychain", "macOS only (process.platform must be 'darwin')");
    }
    this.service = opts.service ?? DEFAULT_SERVICE;
    this.index = createKeychainIndex(opts.indexPath ?? defaultIndexPath());
  }

  async get(path: string): Promise<string | undefined> {
    return findGenericPassword(this.service, path);
  }

  async set(path: string, value: string): Promise<void> {
    await addGenericPassword(this.service, path, value);
    await this.index.add(path);
  }

  async delete(path: string): Promise<void> {
    await deleteGenericPassword(this.service, path);
    await this.index.remove(path);
  }

  async list(prefix?: string): Promise<string[]> {
    return this.index.list(prefix);
  }

  async openForSet(path: string): Promise<SetInstructions> {
    return openPasswordsApp(path, this.service);
  }
}

export { isMacOS } from "./platform.ts";
