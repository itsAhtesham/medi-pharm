export function pgEnvironment(connection: string) {
  const url = new URL(connection);
  if (!['postgres:', 'postgresql:'].includes(url.protocol))
    throw new Error('Expected PostgreSQL connection URL');
  return {
    ...process.env,
    PGHOST: url.hostname,
    PGPORT: url.port || '5432',
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
    PGSSLMODE: url.searchParams.get('sslmode') ?? 'prefer',
  };
}
