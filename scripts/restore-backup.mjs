import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DATA_DIR = join(ROOT, 'data');
const DATA_FILE = join(DATA_DIR, 'objetos.json');
const BACKUP_DIR = join(DATA_DIR, 'backups');
const sourceArgument = process.argv.slice(2).find(argument => argument !== '--');

if (!sourceArgument) {
  console.error('Uso: pnpm restore -- data/backups/objetos-AAAA-MM-DD.json');
  process.exit(1);
}

const source = resolve(sourceArgument);
if (!existsSync(source)) {
  console.error(`No se encontró el respaldo: ${source}`);
  process.exit(1);
}

const raw = await readFile(source, 'utf8');
let restored;
try {
  restored = JSON.parse(raw);
} catch {
  console.error('El respaldo no contiene JSON válido.');
  process.exit(1);
}

const valid = restored && typeof restored.counters === 'object'
  && ['users', 'reports', 'history', 'claims', 'deliveries'].every(key => Array.isArray(restored[key]));
if (!valid) {
  console.error('El respaldo no tiene la estructura esperada de Encuentra UMG.');
  process.exit(1);
}

await mkdir(DATA_DIR, { recursive: true });
await mkdir(BACKUP_DIR, { recursive: true });
if (existsSync(DATA_FILE)) {
  const safetyCopy = join(BACKUP_DIR, `objetos-antes-de-restaurar-${new Date().toISOString().replaceAll(':', '-')}.json`);
  await copyFile(DATA_FILE, safetyCopy);
  console.log(`Copia de seguridad del archivo actual: ${safetyCopy}`);
}

const temporary = join(dirname(DATA_FILE), 'objetos.restore.tmp');
await writeFile(temporary, JSON.stringify(restored, null, 2), 'utf8');
await rename(temporary, DATA_FILE);
console.log(`Datos restaurados correctamente desde: ${source}`);
