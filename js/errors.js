export class ProviderError extends Error {
  constructor(message, { status = 0, retryable = false } = {}) {
    super(message);
    this.status = status;
    this.retryable = retryable;
  }
}

export function httpError(status, detail) {
  const retryable = status === 429 || status >= 500;
  return new ProviderError(`HTTP ${status}${detail ? `: ${detail}` : ''}`, { status, retryable });
}
