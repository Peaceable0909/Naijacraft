import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld } from '../helpers/world.js';
import { CLOSE, DAY_MS, sanitizeLook } from '../../src/world-core.js';
import { memorySql } from '../helpers/sql.js';
import * as P from '../../../shared/protocol.js';
import * as L from '../../../shared/layout.js';

const idxOf = (px, y, pz) => L.cellIndex(px, y, pz);

test('hello: welcome carries identity, clock, limits and the roster', async () => {
  const w = makeWorld();
  const a = await w.join('Tunde');
  const welcome = a.ws.last('welcome');
  assert.equal(welcome.you.name, 'Tunde');
  assert.equal(welcome.you.plot, null);
  assert.equal(welcome.v, P.PROTOCOL_VERSION);
  assert.equal(welcome.time.dayMs, DAY_MS);
  assert.equal(welcome.time.now, w.clock.t);
  assert.ok(welcome.limits.claimable >= 40);
  const b = await w.join('Bisi');
  assert.deepEqual(b.ws.last('welcome').players.map((p) => p.name), ['Tunde'], 'the roster lists the others');
  assert.equal(a.ws.last('join').player.name, 'Bisi', 'existing players hear about the newcomer');
  assert.equal(b.ws.json('join').length, 0, 'the newcomer is not told about themself');
});

test('hello: bad token, wrong protocol version, non-hello first message, and bad JSON all close the socket', async () => {
  const w = makeWorld();
  const bad = w.core.connect(new (await import('../helpers/world.js')).FakeWs());
  await w.core.message(bad, JSON.stringify({ t: 'hello', v: P.PROTOCOL_VERSION, token: 'nope' }));
  assert.equal(bad.ws.closed.code, CLOSE.AUTH);
  assert.equal(bad.ws.last('error').code, 'auth');

  const old = w.core.connect(new (await import('../helpers/world.js')).FakeWs());
  await w.core.message(old, JSON.stringify({ t: 'hello', v: 999, token: w.tokenFor('X1') }));
  assert.equal(old.ws.closed.code, CLOSE.OUTDATED);

  const rude = w.core.connect(new (await import('../helpers/world.js')).FakeWs());
  await w.core.message(rude, JSON.stringify({ t: 'chat', text: 'hi' }));
  assert.equal(rude.ws.closed.code, CLOSE.PROTOCOL);

  const junk = w.core.connect(new (await import('../helpers/world.js')).FakeWs());
  await w.core.message(junk, '{not json');
  assert.equal(junk.ws.closed.code, CLOSE.PROTOCOL);

  const huge = w.core.connect(new (await import('../helpers/world.js')).FakeWs());
  await w.core.message(huge, JSON.stringify({ t: 'hello', pad: 'x'.repeat(9000) }));
  assert.equal(huge.ws.closed.code, CLOSE.PROTOCOL);
  assert.equal(w.core.stats().players, 0);
});

test('hello: signing in again replaces the old session, even when both race', async () => {
  const w = makeWorld();
  const a1 = await w.join('Emeka');
  const a2 = await w.join('Emeka');
  assert.equal(a1.ws.closed.code, CLOSE.REPLACED);
  assert.equal(a1.ws.last('error').code, 'replaced');
  assert.equal(w.core.stats().players, 1);

  const { FakeWs } = await import('../helpers/world.js');
  const r1 = new FakeWs(), r2 = new FakeWs();
  const s1 = w.core.connect(r1), s2 = w.core.connect(r2);
  const hello = JSON.stringify({ t: 'hello', v: P.PROTOCOL_VERSION, token: w.tokenFor('Racer') });
  await Promise.all([w.core.message(s1, hello), w.core.message(s2, hello)]);
  assert.equal(w.core.stats().players, 2, 'Emeka + exactly one Racer');
  assert.equal([r1, r2].filter((r) => r.closed).length, 1);
});

test('hello: the server enforces a capacity and tells the player why', async () => {
  const w = makeWorld();
  for (let i = 0; i < P.LIMITS.maxPlayers + 8; i++) await w.join('P' + i);
  const extra = await w.join('OneMore');
  assert.equal(extra.ws.closed.code, CLOSE.FULL);
  assert.equal(extra.ws.last('error').code, 'full');
});

test('claim: auto picks the best free land, specific plots work, rules are enforced', async () => {
  const w = makeWorld();
  const a = await w.join('Adaeze'), b = await w.join('Bisi'), c = await w.join('Chidi');
  await w.say(a, { t: 'claim', plot: 'auto' });
  assert.equal(a.s.plot, L.OFFLINE_PLOT, 'first claimant gets the plot next to the plaza');
  assert.equal(a.ws.last('claimed').plot, L.OFFLINE_PLOT);
  assert.deepEqual(b.ws.last('plot'), { t: 'plot', n: L.OFFLINE_PLOT, owner: 'Adaeze', name: '' });

  await w.say(b, { t: 'claim', plot: 'auto' });
  assert.notEqual(b.s.plot, a.s.plot, 'second claimant gets the next one');
  await w.say(b, { t: 'claim', plot: 40 });
  assert.equal(b.ws.last('error').code, 'already_claimed');

  const landmark = L.PLOTS.find((p) => !p.claimable);
  await w.say(c, { t: 'claim', plot: landmark.number });
  assert.equal(c.ws.last('error').code, 'not_claimable');
  await w.say(c, { t: 'claim', plot: a.s.plot });
  assert.equal(c.ws.last('error').code, 'plot_taken');
  await w.say(c, { t: 'claim', plot: 999 });
  assert.equal(c.ws.last('error').code, 'no_land');
  await w.say(c, { t: 'claim', plot: 'bogus' });
  assert.equal(c.ws.last('error').code, 'no_land');
  await w.say(c, { t: 'claim', plot: 40 });                       // too many claims in a row are paced
  assert.match(c.ws.last('notice').text, /Slow down/);
  w.clock.t += 3000;
  const wanted = L.claimOrder()[10].number;
  await w.say(c, { t: 'claim', plot: wanted });
  assert.equal(c.s.plot, wanted);
  assert.equal(w.core.stats().claimedPlots, 3);
});

test('claim: ownership survives a server restart and shows in the next welcome', async () => {
  const sql = memorySql();
  const w1 = makeWorld({ sql });
  const a = await w1.join('Tunde');
  await w1.say(a, { t: 'claim', plot: 'auto' });
  const plot = a.s.plot;
  const w2 = makeWorld({ sql, tokens: w1.tokens });
  const again = await w2.join('Tunde');
  assert.equal(again.ws.last('welcome').you.plot, plot);
  assert.ok(again.ws.last('welcome').plots.some((p) => p.n === plot && p.owner === 'Tunde'));
  assert.equal(w2.core.epoch, w1.core.epoch, 'the day clock survives restarts');
});

test('claim: when the land runs out, players are told', async () => {
  const w = makeWorld();
  const total = L.CLAIMABLE_COUNT;
  for (let i = 0; i < total; i++) { const p = await w.join('Owner' + i); await w.say(p, { t: 'claim', plot: 'auto' }); assert.ok(p.s.plot, 'claim ' + i); }
  assert.equal(w.core.stats().freePlots, 0);
  w.clock.t += 5000;
  const late = await w.join('TooLate');
  await w.say(late, { t: 'claim', plot: 'auto' });
  assert.equal(late.ws.last('error').code, 'no_land');
});

test('edit: the owner builds, others see it, the sender is not echoed', async () => {
  const w = makeWorld();
  const a = await w.join('Adaeze'), b = await w.join('Bisi');
  await w.say(a, { t: 'claim', plot: 'auto' });
  a.ws.clear(); b.ws.clear();
  await w.place(a, a.s.plot, [[1, 1, 1, 4, 0], [2, 3, 2, 7, 2]]);
  const seen = b.ws.bin(P.OP.EDITS);
  assert.equal(seen.length, 1);
  const d = P.decodeEditsBroadcast(seen[0]);
  assert.equal(d.plot, a.s.plot);
  assert.equal(d.editor, a.s.pid);
  assert.equal(d.ver, 1);
  assert.deepEqual([...d.packed].map((u) => P.unpackEdit(u).id), [4, 7]);
  assert.equal(a.ws.bin(P.OP.EDITS).length, 0);
  assert.equal(a.ws.json('reject').length, 0);
  const plot = w.core.plots.get(a.s.plot);
  assert.equal(plot.ids[idxOf(1, 1, 1)], 4);
  assert.equal(plot.ids[idxOf(2, 3, 2)], 7);
  assert.equal(plot.metas[idxOf(2, 3, 2)], 2);
});

test('edit: nobody can touch land they do not own', async () => {
  const w = makeWorld();
  const a = await w.join('Adaeze'), b = await w.join('Bisi'), visitor = await w.join('Visitor');
  await w.say(a, { t: 'claim', plot: 'auto' });
  await w.say(b, { t: 'claim', plot: 'auto' });
  a.ws.clear();
  await w.place(b, a.s.plot, [[0, 1, 0, 4, 0]]);                 // Bisi tries Adaeze's plot
  assert.equal(b.ws.last('reject').reason, 'not_owner');
  await w.place(visitor, a.s.plot, [[0, 1, 0, 4, 0]]);           // a player with no land
  assert.equal(visitor.ws.last('reject').reason, 'not_owner');
  await w.place(visitor, 999, [[0, 1, 0, 4, 0]]);
  assert.equal(visitor.ws.last('reject').reason, 'not_owner');
  assert.equal(a.ws.bin(P.OP.EDITS).length, 0, 'nothing reached the owner');
  assert.equal(w.core.plots.get(a.s.plot).ids, null, 'and nothing was stored');
  await w.core.message(visitor.s, P.encodeReplace(a.s.plot, await P.deflate(new Uint8Array(L.PLOT_CELLS * 2).fill(4))));
  assert.equal(visitor.ws.last('reject').reason, 'not_owner', 'whole-plot replace is protected too');
});

test('edit: invalid blocks, the ground layer and malformed messages are rejected without side effects', async () => {
  const w = makeWorld();
  const a = await w.join('Adaeze');
  await w.say(a, { t: 'claim', plot: 'auto' });
  const plot = a.s.plot;
  await w.place(a, plot, [[1, 1, 1, 4, 0], [1, 0, 1, 4, 0]]);               // y = 0 is the ground
  assert.equal(a.ws.last('reject').reason, 'bad_block');
  await w.place(a, plot, [[1, 1, 1, 10, 0]]);                               // asphalt cannot be placed
  assert.equal(a.ws.last('reject').reason, 'bad_block');
  await w.place(a, plot, [[1, 1, 1, 200, 0]]);                              // unknown block
  assert.equal(a.ws.last('reject').reason, 'bad_block');
  await w.core.message(a.s, new Uint8Array([P.OP.EDIT, plot, 0, 5, 0, 0]).buffer);   // count says 5, no data
  assert.equal(a.ws.last('reject').reason, 'bad_edit');
  assert.equal(w.core.plots.get(plot).ids, null, 'the first, half-valid message changed nothing');
  assert.equal(w.core.plots.get(plot).ver, 0);
  await w.core.message(a.s, new Uint8Array([0x55, 1, 2, 3]).buffer);        // unknown opcode is ignored
  await w.core.message(a.s, new ArrayBuffer(0));
  assert.ok(!a.ws.closed);
});

test('edit: a rejected owner is resynced with the stored plot', async () => {
  const w = makeWorld();
  const a = await w.join('Adaeze');
  await w.say(a, { t: 'claim', plot: 'auto' });
  await w.place(a, a.s.plot, [[3, 5, 3, 6, 0]]);
  a.ws.clear();
  await w.place(a, a.s.plot, [[1, 1, 1, 250, 0]]);
  const frame = P.decodePlotData(a.ws.bin(P.OP.PLOTDATA)[0]);
  assert.equal(frame.plot, a.s.plot);
  const parts = P.splitPlotBytes(await P.inflate(frame.blob));
  assert.equal(parts.ids[idxOf(3, 5, 3)], 6, 'the earlier valid edit is in the resync');
});

test('edit: rate limiting stops floods but allows a full-plot fill in one go', async () => {
  const w = makeWorld();
  const a = await w.join('Adaeze');
  await w.say(a, { t: 'claim', plot: 'auto' });
  const plot = a.s.plot;
  const batch = (n, id) => Array.from({ length: n }, (_, i) => [i % 32, 1 + (i >> 10) % 63, (i >> 5) % 32, id, 0]);
  await w.place(a, plot, batch(16384, 4));
  await w.place(a, plot, batch(16384, 5));
  await w.place(a, plot, batch(16384, 6));
  await w.place(a, plot, batch(16384, 4));
  assert.equal(a.ws.json('reject').length, 0, 'about 65k edits fit in the burst allowance');
  await w.place(a, plot, batch(16384, 6));
  assert.equal(a.ws.last('reject').reason, 'slow_down');
  w.clock.t += 60_000;
  a.ws.clear();
  await w.place(a, plot, batch(100, 4));
  assert.equal(a.ws.json('reject').length, 0, 'recovers after a pause');
});

test('persistence: edits are flushed, survive a restart, and reach new players (even before the flush)', async () => {
  const sql = memorySql();
  const w1 = makeWorld({ sql });
  const a = await w1.join('Adaeze');
  await w1.say(a, { t: 'claim', plot: 'auto' });
  const plot = a.s.plot;
  await w1.place(a, plot, [[5, 2, 6, 4, 0], [31, 63, 31, 7, 9]]);

  const early = await w1.join('Early');                         // joins before any flush: blob built on demand
  const f1 = P.decodePlotData(early.ws.bin(P.OP.PLOTDATA)[0]);
  assert.equal(f1.ver, 1);
  assert.equal(P.splitPlotBytes(await P.inflate(f1.blob)).ids[idxOf(5, 2, 6)], 4);

  assert.equal(w1.core.flushNeeded(), true);
  await w1.core.flush();
  assert.equal(w1.core.flushNeeded(), false);
  const row = sql.exec('SELECT ver, length(data) AS n FROM plots WHERE number = ?', plot).toArray()[0];
  assert.equal(row.ver, 1);
  assert.ok(row.n > 0 && row.n < 2000);

  const w2 = makeWorld({ sql, tokens: w1.tokens });             // restart
  const late = await w2.join('Late');
  const f2 = P.decodePlotData(late.ws.bin(P.OP.PLOTDATA)[0]);
  const parts = P.splitPlotBytes(await P.inflate(f2.blob));
  assert.equal(parts.ids[idxOf(5, 2, 6)], 4);
  assert.equal(parts.ids[idxOf(31, 63, 31)], 7);
  assert.equal(parts.metas[idxOf(31, 63, 31)], 9);
  const again = await w2.join('Adaeze');                         // the owner can keep building on the loaded plot
  await w2.place(again, plot, [[6, 2, 6, 5, 0]]);
  await w2.core.flush();
  const w3 = makeWorld({ sql, tokens: w1.tokens });
  const check = await w3.join('Checker');
  const p3 = P.splitPlotBytes(await P.inflate(P.decodePlotData(check.ws.bin(P.OP.PLOTDATA)[0]).blob));
  assert.equal(p3.ids[idxOf(5, 2, 6)], 4, 'old edit kept');
  assert.equal(p3.ids[idxOf(6, 2, 6)], 5, 'new edit added');
});

test('persistence: a newcomer never misses an edit made while the server was preparing their join', async () => {
  const w = makeWorld();
  const a = await w.join('Adaeze');
  await w.say(a, { t: 'claim', plot: 'auto' });
  await w.place(a, a.s.plot, [[1, 1, 1, 4, 0]]);                 // dirty plot without a compressed blob
  const { FakeWs } = await import('../helpers/world.js');
  const ws = new FakeWs();
  const s = w.core.connect(ws);
  const joining = w.core.message(s, JSON.stringify({ t: 'hello', v: P.PROTOCOL_VERSION, token: w.tokenFor('Newbie') }));
  const editing = w.place(a, a.s.plot, [[2, 1, 1, 5, 0]]);       // lands while the newcomer's hello is in flight
  await Promise.all([joining, editing]);
  const frames = ws.sent.filter((d) => typeof d !== 'string');
  const plotFrame = frames.find((f) => new Uint8Array(f, 0, 1)[0] === P.OP.PLOTDATA);
  const editFrames = frames.filter((f) => new Uint8Array(f, 0, 1)[0] === P.OP.EDITS).map((f) => P.decodeEditsBroadcast(f));
  const base = P.decodePlotData(plotFrame);
  const ids = P.splitPlotBytes(await P.inflate(base.blob)).ids;
  const second = ids[idxOf(2, 1, 1)] === 5 || editFrames.some((e) => e.ver > base.ver && [...e.packed].some((u) => P.unpackEdit(u).px === 2));
  assert.ok(second, 'either the snapshot already has it, or a later edit message delivers it');
  assert.equal(ids[idxOf(1, 1, 1)], 4);
});

test('replace: a valid whole-plot upload is stored and broadcast, bad ones are refused', async () => {
  const w = makeWorld();
  const a = await w.join('Adaeze'), b = await w.join('Bisi');
  await w.say(a, { t: 'claim', plot: 'auto' });
  const ids = new Uint8Array(L.PLOT_CELLS), metas = new Uint8Array(L.PLOT_CELLS);
  ids.fill(4, 0, 500); metas[3] = 2;
  b.ws.clear();
  await w.core.message(a.s, P.encodeReplace(a.s.plot, await P.deflate(P.joinPlotArrays(ids, metas))));
  assert.equal(a.ws.json('reject').length, 0);
  const frame = P.decodePlotData(b.ws.bin(P.OP.PLOTDATA)[0]);
  assert.equal(frame.ver, 1);
  assert.equal(w.core.plots.get(a.s.plot).ids[499], 4);

  const bad = new Uint8Array(L.PLOT_CELLS * 2); bad[10] = 250;
  await w.core.message(a.s, P.encodeReplace(a.s.plot, await P.deflate(bad)));
  assert.equal(a.ws.last('reject').reason, 'bad_plot');
  await w.core.message(a.s, P.encodeReplace(a.s.plot, await P.deflate(new Uint8Array(100))));
  assert.equal(a.ws.last('reject').reason, 'bad_plot');
  await w.core.message(a.s, P.encodeReplace(a.s.plot, new Uint8Array([1, 2, 3, 4])));
  assert.equal(a.ws.last('reject').reason, 'bad_plot');
  w.clock.t += 60_000;
  const bomb = await P.deflate(new Uint8Array(20_000_000));
  await w.core.message(a.s, P.encodeReplace(a.s.plot, bomb));
  assert.equal(a.ws.last('reject').reason, 'bad_plot', 'decompression bombs are refused');
  assert.equal(w.core.plots.get(a.s.plot).ver, 1, 'none of the bad uploads changed anything');
});

test('release: giving up land frees it for others and clears it for everyone', async () => {
  const w = makeWorld();
  const a = await w.join('Adaeze'), b = await w.join('Bisi');
  await w.say(a, { t: 'claim', plot: 'auto' });
  const plot = a.s.plot;
  await w.place(a, plot, [[1, 1, 1, 4, 0]]);
  b.ws.clear();
  await w.say(a, { t: 'release' });
  assert.equal(a.s.plot, null);
  assert.equal(b.ws.last('plot').owner, null);
  const cleared = P.decodePlotData(b.ws.bin(P.OP.PLOTDATA)[0]);
  assert.ok(P.splitPlotBytes(await P.inflate(cleared.blob)).ids.every((v) => v === 0));
  w.clock.t += 5000;
  await w.say(b, { t: 'claim', plot });
  assert.equal(b.s.plot, plot, 'someone else can claim it now, and starts empty');
  assert.equal(w.core.plots.get(plot).ids, null);
});

test('snapshots: nearby players are sent once, repeats only on change or heartbeat, distant players never', async () => {
  const w = makeWorld();
  const a = await w.join('Adaeze'), b = await w.join('Bisi'), far = await w.join('Faraway');
  await w.move(a, 100, 1, 100);
  await w.move(b, 110, 1, 100);
  await w.move(far, 300, 1, 300);
  a.ws.clear(); b.ws.clear(); far.ws.clear();
  w.core.tick();
  const toA = P.decodeSnapshot(a.ws.bin(P.OP.SNAPSHOT)[0]);
  assert.deepEqual(toA.map((p) => p.pid), [b.s.pid]);
  assert.ok(Math.abs(toA[0].x - 110) < 0.02);
  assert.equal(far.ws.bin(P.OP.SNAPSHOT).length, 0, 'nobody is near Faraway');
  a.ws.clear();
  w.clock.t += 200;
  w.core.tick();
  assert.equal(a.ws.bin(P.OP.SNAPSHOT).length, 0, 'unchanged players are not re-sent');
  await w.move(b, 111, 1, 100);
  w.core.tick();
  assert.equal(P.decodeSnapshot(a.ws.bin(P.OP.SNAPSHOT)[0])[0].x, 111);
  a.ws.clear();
  w.clock.t += 2100;
  w.core.tick();
  assert.equal(a.ws.bin(P.OP.SNAPSHOT).length, 1, 'heartbeat keeps idle players visible');
  await w.move(far, 120, 1, 100);                                // Faraway walks into range
  a.ws.clear();
  w.core.tick();
  assert.ok(P.decodeSnapshot(a.ws.bin(P.OP.SNAPSHOT)[0]).some((p) => p.pid === far.s.pid));
});

test('snapshots: leaving is announced and positions are sanitised', async () => {
  const w = makeWorld();
  const a = await w.join('Adaeze'), b = await w.join('Bisi');
  a.ws.clear();
  w.core.onClose(b.s);
  assert.deepEqual(a.ws.last('leave'), { t: 'leave', pid: b.s.pid });
  await w.move(a, -50, 1, 99999);
  assert.equal(a.s.x, 0, 'clamped into the world');
  await w.core.message(a.s, new Uint8Array([P.OP.POS, 1, 2]).buffer);
  const flood = await w.join('Flooder');
  for (let i = 0; i < 200; i++) await w.move(flood, 50 + i * 0.1, 1, 50);
  assert.ok(flood.s.x < 53, 'position floods are throttled (200 sent, ~25 accepted)');
});

test('chat: broadcast with filtering, history for newcomers, rate limit and temporary mute', async () => {
  const w = makeWorld();
  const a = await w.join('Adaeze'), b = await w.join('Bisi');
  b.ws.clear();
  await w.say(a, { t: 'chat', text: '  Hello   Lagos  ' });
  assert.deepEqual(b.ws.last('chat'), { t: 'chat', pid: a.s.pid, name: 'Adaeze', text: 'Hello Lagos', ts: w.clock.t });
  await w.say(a, { t: 'chat', text: 'this is shit' });
  assert.equal(b.ws.last('chat').text, 'this is ****');
  await w.say(a, { t: 'chat', text: '   ' });
  await w.say(a, { t: 'chat', text: 123 });
  assert.equal(b.ws.json('chat').length, 2);
  await w.say(a, { t: 'chat', text: 'x'.repeat(500) });
  assert.equal(b.ws.last('chat').text.length, P.LIMITS.chatMax);
  const late = await w.join('Late');
  assert.equal(late.ws.last('welcome').chat.length, 3, 'recent history is replayed');

  w.clock.t += 60_000;
  b.ws.clear();
  for (let i = 0; i < 12; i++) await w.say(a, { t: 'chat', text: 'spam ' + i });
  assert.ok(b.ws.json('chat').length <= 5, 'flood limited');
  assert.match(a.ws.last('notice').text, /paused|Slow down|muted/i);
  const before = b.ws.json('chat').length;
  await w.say(a, { t: 'chat', text: 'still muted' });
  assert.equal(b.ws.json('chat').length, before);
  w.clock.t += 61_000;
  await w.say(a, { t: 'chat', text: 'back' });
  assert.equal(b.ws.last('chat').text, 'back');
});

test('profile: look is validated, plot sign is cleaned and broadcast, achievements are bounded', async () => {
  const w = makeWorld();
  const a = await w.join('Adaeze', { look: { skin: 3, outfit: 99, hat: -1 } });
  assert.deepEqual(a.s.look, { skin: 3, outfit: 0, hat: 0 }, 'out-of-range values fall back');
  await w.say(a, { t: 'claim', plot: 'auto' });
  const b = await w.join('Bisi');
  b.ws.clear();
  w.clock.t += 5000;
  await w.say(a, { t: 'profile', look: { skin: 4, outfit: 3, hat: 2 }, plotName: '  Adaeze‮ Palace  ', achv: { a: 1 } });
  assert.deepEqual(b.ws.last('prof').look, { skin: 4, outfit: 3, hat: 2 });
  assert.equal(b.ws.last('plot').name, 'Adaeze Palace');
  assert.equal(w.core.profile('uid-Adaeze').achv.a, 1);
  w.clock.t += 5000;
  await w.say(a, { t: 'profile', plotName: 'fuck this' });
  assert.equal(b.ws.last('plot').name, '**** this');
  w.clock.t += 5000;
  await w.say(a, { t: 'profile', achv: { big: 'x'.repeat(5000) } });
  assert.equal(w.core.profile('uid-Adaeze').achv.a, 1, 'oversized achievement blobs are ignored');
  const back = await w.join('Adaeze');
  assert.deepEqual(back.ws.last('welcome').you.look, { skin: 4, outfit: 3, hat: 2 }, 'profile persists');
  assert.equal(back.ws.last('welcome').you.achv.a, 1);
  assert.deepEqual(sanitizeLook({ skin: 'x', outfit: 1.5 }), { skin: 2, outfit: 0, hat: 0 });
});

test('report: stored with chat context, throttled, ignored for unknown players', async () => {
  const w = makeWorld();
  const a = await w.join('Reporter'), b = await w.join('Rude');
  for (const text of ['one', 'two']) { await w.say(b, { t: 'chat', text }); w.clock.t += 1000; }
  await w.say(a, { t: 'report', pid: b.s.pid, reason: 'being rude' });
  const reports = await w.core.admin({ cmd: 'reports' });
  assert.equal(reports.length, 1);
  assert.equal(reports[0].target_name, 'Rude');
  assert.deepEqual(reports[0].context, ['one', 'two']);
  assert.match(a.ws.last('notice').text, /Thanks/);
  await w.say(a, { t: 'report', pid: 9999, reason: 'ghost' });
  await w.say(a, { t: 'report', pid: a.s.pid, reason: 'self' });
  assert.equal((await w.core.admin({ cmd: 'reports' })).length, 1);
});

test('admin: summary, players, kick, announce, release and unknown commands', async () => {
  const w = makeWorld();
  const a = await w.join('Adaeze'), b = await w.join('Bisi');
  await w.say(a, { t: 'claim', plot: 'auto' });
  assert.deepEqual((await w.core.admin({ cmd: 'players' })).map((p) => p.name).sort(), ['Adaeze', 'Bisi']);
  const sum = await w.core.admin({ cmd: 'summary' });
  assert.equal(sum.players, 2); assert.equal(sum.claimedPlots, 1);
  await w.core.admin({ cmd: 'announce', text: 'Server restarting soon' });
  assert.equal(b.ws.last('notice').text, 'Server restarting soon');
  assert.deepEqual(await w.core.admin({ cmd: 'kick', name: 'bisi' }), { kicked: true });
  assert.equal(b.ws.closed.code, CLOSE.BANNED);
  assert.equal(w.core.stats().players, 1);
  const owned = a.s.plot;
  const rel = await w.core.admin({ cmd: 'release', plot: owned });
  assert.equal(rel.released, owned);
  assert.equal(a.s.plot, null);
  assert.deepEqual(await w.core.admin({ cmd: 'release', plot: 5 }), { released: null });
  assert.ok((await w.core.admin({ cmd: 'nope' })).error);
});

test('releaseUser (account deletion): land freed, profile removed, session closed', async () => {
  const w = makeWorld();
  const a = await w.join('Adaeze');
  await w.say(a, { t: 'claim', plot: 'auto' });
  assert.deepEqual(await w.core.releaseUser('uid-Adaeze'), { released: L.OFFLINE_PLOT });
  assert.equal(w.core.plots.size, 0);
  assert.equal(w.core.profile('uid-Adaeze'), null);
  assert.equal(a.ws.closed.code, CLOSE.BANNED);
});

test('lifecycle: unauthenticated and idle sockets are reaped; ticking stops when nobody is active', async () => {
  const w = makeWorld();
  const { FakeWs } = await import('../helpers/world.js');
  const lurker = w.core.connect(new FakeWs());
  const a = await w.join('Adaeze');
  w.clock.t += 16_000;
  w.core.tick();
  assert.equal(lurker.ws.closed.code, CLOSE.PROTOCOL, 'never said hello');
  assert.ok(!a.ws.closed || a.s.lastMsg >= w.clock.t - 16_000);
  w.clock.t += 125_000;
  w.core.tick();
  assert.equal(a.ws.closed.code, CLOSE.IDLE);
  assert.equal(w.core.stats().players, 0);

  // a socket that only answers pings counts as alive
  const b = await w.join('Bisi');
  b.s.alive = () => w.clock.t;
  w.clock.t += 125_000;
  w.core.tick();
  assert.equal(b.ws.closed, null);
});

test('hibernation: sessions can be restored from attachments and keep working', async () => {
  const w = makeWorld();
  const a = await w.join('Adaeze');
  await w.say(a, { t: 'claim', plot: 'auto' });
  let att = null;
  a.s.persist = (x) => { att = x; };
  a.s.persist(w.core.attachment(a.s));
  assert.equal(att.plot, a.s.plot);

  const w2 = makeWorld({ sql: w.sql, tokens: w.tokens });          // the object was evicted and reconstructed
  const { FakeWs } = await import('../helpers/world.js');
  const ws = new FakeWs();
  const s = w2.core.restore(ws, att);
  assert.equal(s.name, 'Adaeze');
  await w2.core.message(s, P.encodeEditMessage(att.plot, [P.packEdit(1, 1, 1, 4, 0)]));
  assert.equal(ws.json('reject').length, 0);
  assert.equal(w2.core.plots.get(att.plot).ids[idxOf(1, 1, 1)], 4);
  const friend = await w2.join('Bisi');
  assert.ok(friend.ws.last('welcome').players.some((p) => p.name === 'Adaeze'));
});
