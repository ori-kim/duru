export class SecretNotFound extends Error {
  readonly code = "SECRET_NOT_FOUND";
  constructor(public readonly ref: string) {
    super(`Secret not found: ${ref}`);
    this.name = "SecretNotFound";
  }
}

export class ProviderUnavailable extends Error {
  readonly code = "PROVIDER_UNAVAILABLE";
  constructor(
    public readonly scheme: string,
    message: string,
  ) {
    super(`Provider "${scheme}" unavailable: ${message}`);
    this.name = "ProviderUnavailable";
  }
}

export class PermissionDenied extends Error {
  readonly code = "PERMISSION_DENIED";
  constructor(
    public readonly ref: string,
    message: string,
  ) {
    super(`Permission denied for ${ref}: ${message}`);
    this.name = "PermissionDenied";
  }
}

export class NotSupportedError extends Error {
  readonly code = "NOT_SUPPORTED";
  constructor(
    public readonly scheme: string,
    operation: string,
  ) {
    super(`Provider "${scheme}" does not support: ${operation}`);
    this.name = "NotSupportedError";
  }
}

export class InvalidReference extends Error {
  readonly code = "INVALID_REFERENCE";
  constructor(
    public readonly ref: string,
    reason: string,
  ) {
    super(`Invalid secret reference "${ref}": ${reason}`);
    this.name = "InvalidReference";
  }
}
