import {
  AppError,
  type ErrorEnvelope,
  errorEnvelope,
  internalErrorEnvelope,
} from '../lib/errors.js';

export type { ErrorEnvelope };
export { AppError as ServiceError };

export function toErrorEnvelope(error: unknown): ErrorEnvelope {
  return error instanceof AppError ? errorEnvelope(error) : internalErrorEnvelope();
}
