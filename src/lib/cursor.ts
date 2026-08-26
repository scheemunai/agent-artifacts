import { z } from 'zod';
import { AppError } from './errors.js';

const sortCursorSchema = z.object({ u: z.number().int(), id: z.string().min(1) }).strict();
const versionCursorSchema = z.object({ v: z.number().int().min(1) }).strict();

export interface SortCursor {
  u: number;
  id: string;
}

export interface VersionCursor {
  v: number;
}

export function encodeSortCursor(cursor: SortCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

export function decodeSortCursor(value: string | undefined): SortCursor | null {
  if (!value) {
    return null;
  }

  return parseCursor(value, sortCursorSchema);
}

export function encodeVersionCursor(cursor: VersionCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

export function decodeVersionCursor(value: string | undefined): VersionCursor | null {
  if (!value) {
    return null;
  }

  return parseCursor(value, versionCursorSchema);
}

function parseCursor<T>(value: string, schema: z.ZodType<T>): T {
  try {
    const json = Buffer.from(value, 'base64url').toString('utf8');
    return schema.parse(JSON.parse(json));
  } catch {
    throw new AppError(400, 'validation_failed', 'Invalid pagination cursor', {
      field: 'cursor',
    });
  }
}
