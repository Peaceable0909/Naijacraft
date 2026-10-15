// Copies the browser game (index.html, css, js, shared, assets) into worker/public so that `wrangler deploy`
// serves the game and the API from the same address. Static files are free and unlimited on Cloudflare.
import { cpSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const out = join(here, '..', 'public');

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const item of ['index.html', 'css', 'js', 'shared', 'assets']) {
  const from = join(root, item);
  if (!existsSync(from)) throw new Error(`missing ${item} in ${root}`);
  cpSync(from, join(out, item), { recursive: true });
}
console.log('client copied to', out);
