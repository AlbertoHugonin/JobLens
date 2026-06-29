import { runMigrations } from './migrations.js';
import { createDatabasePool } from './pool.js';

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error('DATABASE_URL is required to run migrations');
}

const pool = createDatabasePool(databaseUrl);

try {
  const result = await runMigrations(pool);
  console.log(
    JSON.stringify(
      {
        applied: result.applied.map((migration) => migration.id),
        latestVersion: result.latestVersion,
      },
      null,
      2,
    ),
  );
} finally {
  await pool.end();
}
