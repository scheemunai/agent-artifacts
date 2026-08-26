export interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

export class ServiceError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(status: number, code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'ServiceError';
    this.status = status;
    this.code = code;
    if (details) {
      this.details = details;
    }
  }
}

export function toErrorEnvelope(error: unknown): ErrorEnvelope {
  if (error instanceof ServiceError) {
    return {
      error: {
        code: error.code,
        message: error.message,
        ...(error.details ? { details: error.details } : {}),
      },
    };
  }

  return {
    error: {
      code: 'internal_error',
      message: 'Internal server error',
    },
  };
}
