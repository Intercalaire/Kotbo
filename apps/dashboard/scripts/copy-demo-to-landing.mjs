import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDemo = path.resolve(__dirname, '../dist-demo');
const landingStaticDemo = path.resolve(__dirname, '../../../../kotbo-landing/static/demo');

if (!fs.existsSync(distDemo)) {
  console.error('dist-demo n\'existe pas. Lancez d\'abord bun run build:demo');
  process.exit(1);
}

console.log(`Copie de ${distDemo} vers ${landingStaticDemo}...`);
fs.rmSync(landingStaticDemo, { recursive: true, force: true });
fs.mkdirSync(landingStaticDemo, { recursive: true });
fs.cpSync(distDemo, landingStaticDemo, { recursive: true });

console.log('✅ Démo copiée avec succès dans la landing !');
