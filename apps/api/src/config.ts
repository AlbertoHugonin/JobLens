export interface ApiConfig {
  corsOrigin: string;
  databaseUrl: string | null;
  host: string;
  logLevel: string;
  nodeEnv: string;
  port: number;
  runMigrations: boolean;
  version: string;
}

function readNumber(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readBoolean(value: string | undefined, fallback: boolean): boolean {
  if (!value) {
    return fallback;
  }

  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  return {
    corsOrigin: env.API_CORS_ORIGIN ?? 'http://localhost:5173',
    databaseUrl: env.DATABASE_URL?.trim() || null,
    host: env.API_HOST ?? env.HOST ?? '0.0.0.0',
    logLevel: env.LOG_LEVEL ?? 'info',
    nodeEnv: env.NODE_ENV ?? 'development',
    port: readNumber(env.API_PORT ?? env.PORT, 3000),
    runMigrations: readBoolean(env.API_RUN_MIGRATIONS, true),
    version: env.npm_package_version ?? '0.0.0',
  };
}
