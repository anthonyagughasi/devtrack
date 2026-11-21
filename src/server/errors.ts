export class AppError extends Error {
  public readonly statusCode: number;

  constructor(statusCode: number, message: string, options?: ErrorOptions) {
    super(message, options);
    this.statusCode = statusCode;
    this.name = 'AppError';
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

export interface DatabaseErrorDetails {
  code?: string;
  constraint?: string;
  message: string;
}

export function extractDatabaseErrorDetails(error: unknown): DatabaseErrorDetails {
  const queue: unknown[] = [error];
  const seen = new Set<unknown>();
  let fallbackMessage = error instanceof Error ? error.message : String(error ?? '');

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || typeof current !== 'object' || seen.has(current)) continue;
    seen.add(current);

    const record = current as {
      code?: unknown;
      constraint?: unknown;
      message?: unknown;
      cause?: unknown;
      errors?: unknown;
    };

    if (typeof record.message === 'string' && record.message.trim() && !fallbackMessage) {
      fallbackMessage = record.message.trim();
    }

    if (typeof record.code === 'string' && record.code.trim()) {
      return {
        code: record.code.trim(),
        constraint: typeof record.constraint === 'string' ? record.constraint : undefined,
        message: typeof record.message === 'string' ? record.message : fallbackMessage,
      };
    }

    if (record.cause) queue.push(record.cause);
    if (Array.isArray(record.errors)) {
      for (const inner of record.errors) {
        queue.push(inner);
      }
    }
  }

  return { message: fallbackMessage };
}

export function mapDatabaseError(
  error: unknown,
  options?: { duplicateMessage?: string }
): AppError | null {
  if (isAppError(error)) return error;

  const details = extractDatabaseErrorDetails(error);
  const code = details.code ?? '';
  const lowerMsg = details.message.toLowerCase();

  if (code === '23505') {
    return new AppError(
      409,
      options?.duplicateMessage ?? 'A record with this unique value already exists.',
      { cause: error }
    );
  }

  if (
    code === 'ECONNREFUSED' ||
    code === 'ENOTFOUND' ||
    code === 'ETIMEDOUT' ||
    code === 'ECONNRESET' ||
    code === 'EHOSTUNREACH' ||
    code === 'ENETUNREACH' ||
    code === 'ENOENT' ||
    code === '57P01' ||
    code === '57P03' ||
    lowerMsg.includes('connection terminated') ||
    lowerMsg.includes('timeout exceeded when trying to connect')
  ) {
    return new AppError(
      503,
      'Database service is unavailable. Verify DATABASE_URL or SQL_* connection settings and network access.',
      { cause: error }
    );
  }

  if (code === '28P01' || code === '28000') {
    return new AppError(
      503,
      'Database authentication failed. Check the database credentials in server environment variables.',
      { cause: error }
    );
  }

  if (code === '3D000') {
    return new AppError(
      503,
      'Configured database does not exist. Verify SQL_DB_NAME or DATABASE_URL.',
      { cause: error }
    );
  }

  if (code === '42P01') {
    return new AppError(
      503,
      'Database tables are not initialized. Push the schema to the configured PostgreSQL database.',
      { cause: error }
    );
  }

  return null;
}

