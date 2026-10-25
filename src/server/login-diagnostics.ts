// Database errors can contain SQL parameters. Log only known metadata, never the
// error object, message, stack, request body, connection string, or credentials.
export function loginFailureDetails(error: unknown) {
  const codes = new Set<string>();
  const types = new Set<string>();
  const seen = new Set<object>();
  function collect(value: unknown, depth = 0) {
    if (!value || typeof value !== 'object' || depth > 5 || seen.has(value)) return;
    seen.add(value);
    const item = value as { code?: unknown; name?: unknown; cause?: unknown; errors?: unknown };
    if (typeof item.code === 'string' && /^[A-Z0-9_]{2,40}$/.test(item.code)) codes.add(item.code);
    if (
      typeof item.name === 'string' &&
      [
        'Error',
        'TypeError',
        'RangeError',
        'AggregateError',
        'DrizzleQueryError',
        'DatabaseError',
      ].includes(item.name)
    )
      types.add(item.name);
    collect(item.cause, depth + 1);
    if (Array.isArray(item.errors))
      item.errors.slice(0, 5).forEach((entry) => collect(entry, depth + 1));
  }
  collect(error);
  return {
    errorTypes: [...types],
    errorCodes: [...codes],
    configuration: {
      databaseUrlConfigured: !!process.env.DATABASE_URL,
      jwtSecretValid: (process.env.JWT_SECRET?.length ?? 0) >= 32,
      rateLimitSecretValid: (process.env.RATE_LIMIT_SECRET?.length ?? 0) >= 32,
      appUrlConfigured: !!process.env.APP_URL,
    },
  };
}
