import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load as yamlLoad } from 'js-yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const yamlPath = resolve(root, 'pilseros.yaml');
const outPath = resolve(root, 'src/data/pilseros.json');

let raw;
try {
  raw = readFileSync(yamlPath, 'utf-8');
} catch {
  console.error('⚠  pilseros.yaml not found at', yamlPath);
  process.exit(1);
}

const data = yamlLoad(raw);
if (!data || typeof data !== 'object' || Array.isArray(data)) {
  console.error('⚠  pilseros.yaml must contain a mapping at the root level');
  process.exit(1);
}

writeFileSync(outPath, JSON.stringify(data, null, 2) + '\n');
console.log('✓ pilseros.json generated from pilseros.yaml');
