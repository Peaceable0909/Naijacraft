// End-to-end test: the real browser game (headless Chromium) against the real server (wrangler dev).
//   npm install && npx playwright install chromium     (once)
//   npm run test:e2e
// Set BABYLON_FILE=/path/to/babylon.js to serve the 3D engine from disk instead of the CDN.
import { chromium } from 'playwright';
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = 8798;
const URL = `http://127.0.0.1:${PORT}/`;
const here = path.dirname(fileURLToPath(import.meta.url));
const worker = path.resolve(here, '../../worker');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const check = (name, ok, extra = '') => { console.log((ok ? '  ok  ' : ' FAIL ') + name + (extra ? '  ' + extra : '')); if (!ok) fails++; };

// ---------------------------------------------------------------- server
const state = mkdtempSync(path.join(tmpdir(), 'naijacraft-e2e-'));
spawnSync('node', ['scripts/build-client.mjs'], { cwd: worker, stdio: 'ignore' });
const server = spawn('npx', ['wrangler', 'dev', '--local', '--ip', '127.0.0.1', '--port', String(PORT), '--persist-to', state, '--var', 'AUTH_PEPPER:e2e-pepper'], {
  cwd: worker, detached: true, stdio: 'ignore', env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1', NO_COLOR: '1' },
});
async function shutdown(code) {
  try { process.kill(-server.pid, 'SIGTERM'); } catch { /* gone */ }
  await sleep(800);
  rmSync(state, { recursive: true, force: true });
  process.exit(code);
}
process.on('SIGINT', () => shutdown(130));
for (let i = 0; i < 90; i++) {
  try { if ((await fetch(URL + 'health')).ok) break; } catch { /* starting */ }
  await sleep(1000);
  if (i === 89) { console.error('the server did not start'); await shutdown(1); }
}

// ---------------------------------------------------------------- browser
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const errors = [];
async function newPage(viewport = { width: 1100, height: 700 }) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error' && !/404|401|favicon/.test(m.text())) errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  if (process.env.BABYLON_FILE) {
    await page.route('**/babylonjs@7.31.0/babylon.js', (r) => r.fulfill({ body: readFileSync(process.env.BABYLON_FILE), contentType: 'application/javascript' }));
  }
  return page;
}
async function openGame(page, url = URL) {
  await page.goto(url);
  await page.waitForSelector('#menu:not(.hidden), #fatal:not(.hidden)', { timeout: 180000 });
  if (await page.$('#fatal:not(.hidden)')) throw new Error('the game could not start: ' + await page.textContent('#fatal-text'));
}
const started = (page) => page.waitForFunction(() => window.__naija && window.__naija.state.started, { timeout: 60000 });

async function pickPlot(page, number) {
  const box = await page.$eval('#claim-map', (c) => { const r = c.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
  const col = (number - 1) % 8, row = Math.floor((number - 1) / 8);       // the map draws plot 1 at the top left
  await page.mouse.click(box.x + ((8 + col * 40 + 16) / 328) * box.w, box.y + ((8 + row * 40 + 16) / 356) * box.h);
}

try {
  // ============================================================ 1. two players share one Lagos
  console.log('two players');
  const A = await newPage(), B = await newPage();
  await openGame(A); await openGame(B);
  check('the start screen finds the server and offers sign in', await A.evaluate(() => !document.querySelector('[data-view=choose]').classList.contains('hidden')));
  for (const [P, plot] of [[A, 18], [B, 19]]) {
    await P.click('#guest-play');
    await P.waitForSelector('#claim:not(.hidden)', { timeout: 60000 });
    await pickPlot(P, plot);
    await P.click('#claim-go');
    await started(P);
  }
  const mine = await A.evaluate(() => window.__naija.G.myPlot);
  check('each player owns the plot they chose', mine.number === 18 && (await B.evaluate(() => window.__naija.G.myPlot.number)) === 19);
  await A.evaluate((p) => { const n = window.__naija, e = []; for (let x = 4; x < 12; x++) for (let y = 1; y < 4; y++) e.push([p.x + x, y, p.z + 10, 5, 0]); n.applyEdits(e); }, mine);
  await sleep(2000);
  check("B sees A's wall", (await B.evaluate((p) => window.__naija.world.get(p.x + 5, 2, p.z + 10), mine)) === 5);
  const denied = await B.evaluate((p) => window.__naija.canEdit(p.x + 5, 2, p.z + 10), mine);
  check("B cannot edit A's plot", denied === false);
  await A.keyboard.press('Enter');
  await A.keyboard.type('How far, Lagos!');
  await A.keyboard.press('Enter');
  await sleep(1500);
  check('chat arrives', (await B.$$eval('#chat-log .msg', (els) => els.map((e) => e.textContent))).some((t) => t.includes('How far, Lagos!')));
  await A.evaluate(() => { const n = window.__naija; n.player.pos = { x: 100, y: 1, z: 150 }; });
  await sleep(2500);
  check('B sees the avatar of A', await B.evaluate(() => [...window.__naija.remote.players.values()].some((r) => r.samples.length > 0)));
  check('the players list counts both', (await A.evaluate(() => window.__naija.G.online.players.size)) === 2);
  await A.context().close(); await B.context().close();

  // ============================================================ 2. account life cycle
  console.log('accounts');
  const C = await newPage();
  await openGame(C);
  const name = 'Builder' + Math.floor(1000 + Math.random() * 9000);
  await C.click('#auth-tabs [data-tab=signup]');
  await C.fill('#signup-name', name);
  await C.fill('#signup-pass', 'password');
  await C.click('#signup-go');
  check('a very common password is refused', /too easy/.test(await C.textContent('#menu-error')));
  await C.fill('#signup-pass', 'correct horse battery');
  await C.click('#signup-go');
  await C.waitForSelector('#modal:not(.hidden)', { timeout: 60000 });
  const recovery = (await C.textContent('#modal-body .code')).trim();
  check('sign-up shows a recovery code', /^[0-9A-Z]{4}(-[0-9A-Z]{4}){3}$/.test(recovery), recovery);
  await C.click('#modal-actions .primary');
  await C.waitForSelector('#claim:not(.hidden)', { timeout: 60000 });
  await C.click('#claim-auto');
  await started(C);
  await C.evaluate(() => { const n = window.__naija, p = n.G.myPlot, e = []; for (let x = 3; x < 9; x++) e.push([p.x + x, 1, p.z + 5, 5, 0]); n.applyEdits(e); n.G.online.profile({ plotName: 'My Test Palace' }); });
  await sleep(1500);
  await C.evaluate(() => { document.exitPointerLock && document.exitPointerLock(); window.__naija.showMode('paused'); });
  await C.click('#tab-account');
  await Promise.all([C.waitForNavigation(), C.click('#acct-signout')]);
  await C.waitForSelector('#menu:not(.hidden)', { timeout: 180000 });
  await C.click('#auth-tabs [data-tab=login]');
  await C.fill('#login-name', name);
  await C.fill('#login-pass', 'not the password');
  await C.click('#login-go');
  await C.waitForFunction(() => document.getElementById('menu-error').textContent.length > 0, { timeout: 60000 });
  check('a wrong password is refused', /Wrong username or password/.test(await C.textContent('#menu-error')));
  await C.fill('#login-pass', 'correct horse battery');
  await C.click('#login-go');
  await started(C);
  await sleep(1500);
  const back = await C.evaluate(() => { const n = window.__naija, p = n.G.myPlot; return { wall: n.world.get(p.x + 3, 1, p.z + 5), plotName: n.state.plotName, guest: n.G.online.you.guest }; });
  check('signing back in restores the plot, its sign and the account type', back.wall === 5 && back.plotName === 'My Test Palace' && back.guest === false, JSON.stringify(back));
  await C.evaluate(() => { try { localStorage.removeItem('naijacraft:v2:auth'); } catch {} location.reload(); });
  await C.waitForSelector('#menu:not(.hidden)', { timeout: 180000 });
  await C.click('#auth-tabs [data-tab=login]');
  await C.click('#forgot-link');
  await C.fill('#rec-name', name); await C.fill('#rec-code', recovery); await C.fill('#rec-pass', 'a brand new password 42');
  await C.click('#rec-go');
  await C.waitForSelector('#modal:not(.hidden)', { timeout: 60000 });
  check('the recovery code resets the password and issues a new code', (await C.textContent('#modal-body .code')).trim() !== recovery);
  await C.click('#modal-actions .primary');
  await started(C);
  await C.context().close();

  // ============================================================ 3. offline mode (no server)
  console.log('offline mode');
  const D = await newPage();
  await openGame(D, `http://127.0.0.1:${PORT}/?server=off`);
  await D.evaluate(() => { localStorage.clear(); });
  const offline = await D.evaluate(() => !document.querySelector('[data-view=offline]').classList.contains('hidden') || !document.querySelector('[data-view=choose]').classList.contains('hidden'));
  check('the start screen loads', offline);
  await D.evaluate(() => window.__naija.enterOffline('Reggie'));
  await started(D);
  const plot = await D.evaluate(() => { const p = window.__naija.G.myPlot; return { x: p.x, z: p.z, n: p.number }; });
  check('offline players own plot 28', plot.n === 28);
  const placed = await D.evaluate((p) => {
    const n = window.__naija; n.settings.freezeTime = true;
    const pl = n.player; pl.pos = { x: p.x + 10.5, y: 1, z: p.z + 6.5 }; pl.flying = true; pl.yaw = 0; pl.pitch = 0.9;
    return n.tryPlace(n.getTarget());
  }, plot);
  check('placing a block', placed === true);
  check('undo and redo', await D.evaluate(() => { const n = window.__naija; const a = n.undo(); const b = n.redo(); return a && b; }));
  check('other plots, roads and the ground are protected', await D.evaluate(() => { const n = window.__naija; return !n.canEdit(10, 1, 10) && !n.canEdit(164, 0, 160) && !n.canEdit(150, 1, 200); }));
  const blueprint = await D.evaluate(async (p) => {
    const { blueprints } = await import('./js/prefabs.js');
    const n = window.__naija, pl = n.player;
    pl.pos = { x: p.x + 16.5, y: 1, z: p.z + 22.5 }; pl.yaw = Math.PI; pl.pitch = 0.5;
    n.startBlueprint(blueprints().find((b) => b.name === 'Bungalow'));
    return n.placePaste();
  }, plot);
  check('a blueprint builds', blueprint === true);
  const code = await D.evaluate(() => window.__naija.exportCode());
  check('the plot exports as a share code', /^NJC2:[^:]*:[A-Za-z0-9+/=]+$/.test(code));
  await D.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await D.reload();
  await D.waitForSelector('#menu:not(.hidden), #fatal:not(.hidden)', { timeout: 180000 });
  await D.evaluate(() => window.__naija.enterOffline('Reggie'));
  await started(D);
  const cells = await D.evaluate((p) => { const w = window.__naija.world; let c = 0; for (let x = 0; x < 32; x++) for (let y = 1; y < 20; y++) for (let z = 0; z < 32; z++) if (w.get(p.x + x, y, p.z + z)) c++; return c; }, plot);
  check('the plot is still there after a reload', cells > 300, cells + ' blocks');

  check('no unexpected console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
} catch (e) {
  console.error(e);
  fails++;
}
await browser.close();
console.log(fails ? `\n${fails} check(s) failed` : '\nall end-to-end checks passed');
await shutdown(fails ? 1 : 0);
