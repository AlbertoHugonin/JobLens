import pg from 'pg';

const { Pool } = pg;

export type DatabasePool = pg.Pool;

export function createDatabasePool(databaseUrl: string): DatabasePool {
  return new Pool({
    connectionString: databaseUrl,
    max: 10,
  });
}
