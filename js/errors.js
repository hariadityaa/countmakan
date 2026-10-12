// kind is one of: network, timeout, http, output, cancel, other.
export class ProviderError extends Error {
  constructor(message, { status = 0, retryable = false, kind = 'other' } = {}) {
    super(message);
    this.status = status;
    this.retryable = retryable;
    this.kind = kind;
  }
}

export function httpError(status, detail) {
  const retryable = status === 429 || status >= 500;
  return new ProviderError(`HTTP ${status}${detail ? `: ${detail}` : ''}`, { status, retryable, kind: 'http' });
}
