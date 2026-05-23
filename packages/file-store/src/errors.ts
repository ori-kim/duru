export class DuruFileStorePathError extends Error {
  constructor(path: string, message: string) {
    super(`Invalid file-store path "${path}": ${message}`);
    this.name = "DuruFileStorePathError";
  }
}

export class DuruFileStoreParseError extends Error {
  constructor(
    readonly path: string,
    readonly codec: string,
    cause: unknown,
  ) {
    super(`Failed to parse "${path}" with codec "${codec}": ${errorMessage(cause)}`);
    this.name = "DuruFileStoreParseError";
    this.cause = cause;
  }
}

export class DuruFileStoreWriteError extends Error {
  constructor(
    readonly path: string,
    cause: unknown,
  ) {
    super(`Failed to write "${path}": ${errorMessage(cause)}`);
    this.name = "DuruFileStoreWriteError";
    this.cause = cause;
  }
}

export class DuruFileStoreCodecError extends Error {
  constructor(codecOrPath: string) {
    super(`Unknown file-store codec for "${codecOrPath}"`);
    this.name = "DuruFileStoreCodecError";
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
