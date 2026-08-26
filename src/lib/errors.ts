import type { ContentfulStatusCode } from 'hono/utils/http-status';

export interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
    request_id?: string;
  };
}

export class AppError extends Error {
  readonly status: ContentfulStatusCode;
  readonly code: string;
  readonly details?: Record<string, unknown>;
  readonly headers: Record<string, string>;

  constructor(
    status: ContentfulStatusCode,
    code: string,
    message: string,
    details?: Record<string, unknown>,
    headers: Record<string, string> = {}
  ) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    if (details) {
      this.details = details;
    }
    this.headers = headers;
  }
}

export function errorEnvelope(error: AppError, requestId?: string): ErrorEnvelope {
  return {
    error: {
      code: error.code,
      message: error.message,
      ...(error.details ? { details: error.details } : {}),
      ...(error.code === 'internal_error' && requestId ? { request_id: requestId } : {}),
    },
  };
}

export function internalErrorEnvelope(requestId?: string): ErrorEnvelope {
  return {
    error: {
      code: 'internal_error',
      message: 'Internal server error',
      ...(requestId ? { request_id: requestId } : {}),
    },
  };
}
