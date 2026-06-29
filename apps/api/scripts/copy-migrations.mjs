import { cpSync, existsSync, mkdirSync } from 'node:fs';

const source = new URL('../src/db/migrations', import.meta.url);
const target = new URL('../dist/db/migrations', import.meta.url);

if (existsSync(source)) {
  mkdirSync(new URL('../dist/db', import.meta.url), { recursive: true });
  cpSync(source, target, { recursive: true });
}
