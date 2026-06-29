import { buildApp } from './app.js';
import { readConfig } from './config.js';
import { runMigrations } from './db/migrations.js';
import { createDatabasePool } from './db/pool.js';

const config = readConfig();
const db = config.databaseUrl ? createDatabasePool(config.databaseUrl) : undefined;

if (db && config.runMigrations) {
  const result = await runMigrations(db);
  if (result.applied.length > 0) {
    console.log(
      JSON.stringify({
        event: 'database_migrations_applied',
        applied: result.applied.map((migration) => migration.id),
        latestVersion: result.latestVersion,
      }),
    );
  }
}

const app = await buildApp(config, { closeDbOnClose: true, db });

try {
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
