export type DuruFileHome = {
  readonly root: string;
  resolve(path?: string): string;
  scope(name: string): FileStore;
  store(path?: string): FileStore;
};

export type FileStore = {
  readonly root: string;
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

export type FileStoreDirEntry = {
  readonly name: string;
  readonly path: string;
  readonly type: "file" | "directory" | "other";
  readonly isFile: boolean;
  readonly isDirectory: boolean;
};

export type FileCodec<T = unknown> = {
  readonly id: string;
  readonly extensions: readonly string[];
  parse(text: string, ctx: FileCodecContext): T;
  stringify(value: T, ctx: FileCodecContext): string;
};

export type FileCodecContext = {
  readonly path: string;
  readonly codec: string;
};

export type CreateDuruFileHomeOptions = {
  readonly home?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly defaultHome?: string;
  readonly codecs?: readonly FileCodec[];
};

export type CreateFileStoreOptions = {
  readonly root: string;
  readonly codecs?: readonly FileCodec[];
};

export type WriteOptions = {
  readonly atomic?: boolean;
};

export type ReadStructuredOptions = {
  readonly codec?: string;
};

export type WriteStructuredOptions = WriteOptions & {
  readonly codec?: string;
};

export type RemoveOptions = {
  readonly recursive?: boolean;
};
