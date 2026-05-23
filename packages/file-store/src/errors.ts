export class ClipFileStorePathError extends Error {
  constructor(path: string, message: string) {
    super(`Invalid file-store path "${path}": ${message}`);
    this.name = "ClipFileStorePathError";
  }
}

export class ClipFileStoreParseError extends Error {
  constructor(
    readonly path: string,
    readonly codec: string,
    cause: unknown,
  ) {
    super(`Failed to parse "${path}" with codec "${codec}": ${errorMessage(cause)}`);
    this.name = "ClipFileStoreParseError";
    this.cause = cause;
  }
}

export class ClipFileStoreWriteError extends Error {
  constructor(
    readonly path: string,
    cause: unknown,
  ) {
    super(`Failed to write "${path}": ${errorMessage(cause)}`);
    this.name = "ClipFileStoreWriteError";
    this.cause = cause;
  }
}

export class ClipFileStoreCodecError extends Error {
  constructor(codecOrPath: string) {
    super(`Unknown file-store codec for "${codecOrPath}"`);
    this.name = "ClipFileStoreCodecError";
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
