import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../shared/layout.js';
import * as P from '../shared/protocol.js';
import * as M from '../shared/moderation.js';
import { BLOCKS } from '../js/blocks.js';

test('layout: 64 plots numbered row-major, districts and lookup agree', () => {
  assert.equal(L.PLOTS.length, 64);
  assert.equal(L.CITY, L.ROAD + L.GRID * L.PITCH);
  for (const p of L.PLOTS) {
    assert.equal(p.number, p.row * L.GRID + p.col + 1);
    assert.equal(L.plotByNumber(p.number), p);
    // the centre and all four corners of a plot map back to it; the road around it does not
    for (const [dx, dz] of [[0, 0], [L.PLOT - 1, 0], [0, L.PLOT - 1], [L.PLOT - 1, L.PLOT - 1], [16, 16]]) {
      assert.equal(L.plotAt(p.x + dx, p.z + dz), p);
    }
    assert.equal(L.plotAt(p.x - 1, p.z), null);
    assert.equal(L.plotAt(p.x + L.PLOT, p.z), null);
    assert.equal(L.plotAt(p.x, p.z + L.PLOT), null);
  }
  assert.equal(L.plotByNumber(0), null);
  assert.equal(L.plotByNumber(65), null);
  assert.equal(L.plotByNumber(1.5), null);
});

test('layout: districts cover every plot, two plot columns wide', () => {
  const names = new Set(L.PLOTS.map((p) => p.district));
  assert.deepEqual([...names].sort(), [...L.DISTRICT_NAMES.flat()].sort());
  assert.equal(L.districtAt(10, L.CITY + 5), 'Bar Beach');
  for (const p of L.PLOTS) assert.equal(p.district, L.DISTRICT_NAMES[p.row < 4 ? 0 : 1][Math.floor(p.col / 2)]);
});

test('layout: claim order starts next to the plaza and covers only free plots', () => {
  const order = L.claimOrder();
  assert.equal(order.length, L.CLAIMABLE_COUNT);
  assert.ok(order.every((p) => p.claimable && p.kind === 'free'));
  assert.ok(L.CLAIMABLE_COUNT >= 40, 'plenty of land for new players');
  assert.equal(order[0].number, L.OFFLINE_PLOT, 'offline plot is the best free plot');
  assert.equal(L.plotByNumber(L.OFFLINE_PLOT).claimable, true);
});

test('layout: cellIndex is dense and unique over the plot volume', () => {
  assert.equal(L.cellIndex(0, 1, 0), 0);
  assert.equal(L.cellIndex(31, L.HEIGHT - 1, 31), L.PLOT_CELLS - 1);
  assert.equal(L.cellIndex(1, 1, 0), 1);
  assert.equal(L.cellIndex(0, 1, 1), L.PLOT);
  assert.equal(L.cellIndex(0, 2, 0), L.PLOT * L.PLOT);
});

test('layout constants stay in sync with the block registry', () => {
  assert.equal(L.MAX_BLOCK_ID, BLOCKS.length - 1);
  const placeable = BLOCKS.map((b, id) => (b.placeable ? id : null)).filter((x) => x !== null);
  for (const id of L.NON_PLACEABLE) assert.equal(BLOCKS[id].placeable, false, `block ${id} must be non-placeable`);
  const nonPlaceable = BLOCKS.map((b, id) => (id > 0 && !b.placeable ? id : null)).filter((x) => x !== null);
  assert.deepEqual(nonPlaceable, L.NON_PLACEABLE);
  assert.ok(placeable.length > 40);
});

test('protocol: position round trip within quantisation error', () => {
  const s = { x: 163.27, y: 12.5, z: 300.9, yaw: 4.2, pitch: -0.6, flags: P.FLAG.FLYING | P.FLAG.SPRINT, emote: 3 };
  const buf = P.encodePos(s);
  assert.equal(buf.byteLength, 11);
  const d = P.decodePos(buf);
  assert.ok(Math.abs(d.x - s.x) < 1 / 64 + 1e-9);
  assert.ok(Math.abs(d.y - s.y) < 1 / 64 + 1e-9);
  assert.ok(Math.abs(d.z - s.z) < 1 / 64 + 1e-9);
  assert.ok(Math.abs(d.yaw - s.yaw) < (Math.PI * 2) / 256);
  assert.ok(Math.abs(d.pitch - s.pitch) < 0.02);
  assert.equal(d.flags, s.flags);
  assert.equal(d.emote, 3);
  assert.equal(P.decodePos(new ArrayBuffer(10)), null);
});

test('protocol: quantisation clamps out-of-range values instead of wrapping', () => {
  assert.equal(P.quantX(-5), 0);
  assert.equal(P.quantX(1e9), 65535);
  assert.equal(P.quantY(-100), 0);
  assert.equal(P.quantYaw(-Math.PI / 2), P.quantYaw((3 * Math.PI) / 2));
  assert.equal(P.quantPitch(10), 127);
  assert.equal(P.quantPitch(-10), -127);
});

test('protocol: snapshot round trip', () => {
  const list = [0, 1, 2, 65535].map((pid, i) => ({ pid, qx: 1000 + i, qy: 2000 + i, qz: 3000 + i, qyaw: 10 * i, qpitch: -i, flags: i, emote: i }));
  const out = P.decodeSnapshot(P.encodeSnapshot(list));
  assert.equal(out.length, 4);
  assert.equal(out[3].pid, 65535);
  assert.equal(out[2].x, P.dequantX(1002));
  assert.equal(out[1].pitch, P.dequantPitch(-1));
  assert.equal(P.decodeSnapshot(new Uint8Array([P.OP.SNAPSHOT, 3, 0]).buffer), null, 'length mismatch is rejected');
});

test('protocol: edits pack and unpack every field', () => {
  const u = P.packEdit(31, 63, 17, 255, 200);
  const e = P.unpackEdit(u);
  assert.deepEqual(e, { px: 31, pz: 17, y: 63, id: 255, meta: 200 });
  assert.ok(u >= 0 && u <= 0xffffffff);
  const msg = P.encodeEditMessage(12, [P.packEdit(1, 2, 3, 4, 5), P.packEdit(6, 7, 8, 9, 10)]);
  const d = P.decodeEditMessage(msg);
  assert.equal(d.plot, 12);
  assert.deepEqual([...d.packed].map((x) => P.unpackEdit(x).id), [4, 9]);
  const bc = P.decodeEditsBroadcast(P.encodeEditsBroadcast(5, 123456, 77, [P.packEdit(0, 1, 0, 1)]));
  assert.deepEqual([bc.plot, bc.ver, bc.editor, bc.packed.length], [5, 123456, 77, 1]);
  assert.equal(P.decodeEditMessage(new ArrayBuffer(3)), null);
  const truncated = P.encodeEditMessage(1, [1, 2, 3]).slice(0, 10);
  assert.equal(P.decodeEditMessage(truncated), null);
});

test('protocol: placeable ids', () => {
  assert.equal(P.isPlaceableId(0), true);
  assert.equal(P.isPlaceableId(4), true);
  for (const id of L.NON_PLACEABLE) assert.equal(P.isPlaceableId(id), false);
  assert.equal(P.isPlaceableId(L.MAX_BLOCK_ID + 1), false);
  assert.equal(P.isPlaceableId(255), false);
});

test('protocol: plot blobs deflate, inflate, and reject oversize or corrupt data', async () => {
  const ids = new Uint8Array(L.PLOT_CELLS), metas = new Uint8Array(L.PLOT_CELLS);
  ids[5] = 4; ids[L.PLOT_CELLS - 1] = 6; metas[5] = 3;
  const raw = P.joinPlotArrays(ids, metas);
  const blob = await P.deflate(raw);
  assert.ok(blob.length < 600, `mostly-air plot compresses well (got ${blob.length})`);
  const back = P.splitPlotBytes(await P.inflate(blob));
  assert.equal(back.ids[5], 4); assert.equal(back.ids[L.PLOT_CELLS - 1], 6); assert.equal(back.metas[5], 3);
  assert.equal(P.splitPlotBytes(new Uint8Array(10)), null);
  const bomb = await P.deflate(new Uint8Array(5_000_000));
  await assert.rejects(() => P.inflate(bomb), /too large/);
  await assert.rejects(() => P.inflate(new Uint8Array([1, 2, 3, 4, 5])));
  assert.equal(P.validatePlotIds(ids), true);
  ids[7] = 250;
  assert.equal(P.validatePlotIds(ids), false);
  const frame = P.decodePlotData(P.encodePlotData(9, 42, blob));
  assert.deepEqual([frame.plot, frame.ver, frame.blob.length], [9, 42, blob.length]);
  const rep = P.decodeReplace(P.encodeReplace(9, blob));
  assert.deepEqual([rep.plot, rep.blob.length], [9, blob.length]);
});

test('moderation: usernames', () => {
  assert.equal(M.validateUsername('PeaceableBuilds'), null);
  assert.equal(M.validateUsername('Tunde_99'), null);
  assert.ok(M.validateUsername('ab'));
  assert.ok(M.validateUsername('has space'));
  assert.ok(M.validateUsername('x'.repeat(17)));
  assert.ok(M.validateUsername('Admin'), 'reserved');
  assert.ok(M.validateUsername('NaijaCraft'), 'reserved');
  assert.ok(M.validateUsername('Guest1234'), 'looks like an auto name');
  assert.ok(M.validateUsername('my_shit'));
  assert.ok(M.validateUsername('sh1t99'));
  assert.equal(M.validateUsername('Shittu'), null, 'real surnames are fine');
  assert.equal(M.validateUsername('Dickson'), null);
  assert.ok(M.validateUsername('zorp', 'zorp'), 'operator-supplied words');
});

test('moderation: chat masking by whole word', () => {
  assert.equal(M.maskBlocked('hello Lagos'), 'hello Lagos');
  assert.equal(M.maskBlocked('this is shit!'), 'this is *****');
  assert.match(M.maskBlocked('what the f.u.c.k'), /\*+$/);
  assert.match(M.maskBlocked('FUUUCK you'), /^\*+ you$/);
  assert.equal(M.maskBlocked('Mr Shittu said hi'), 'Mr Shittu said hi');
  assert.equal(M.maskBlocked('a hit and a miss'), 'a hit and a miss');
});

test('moderation: cleanText strips control and bidi characters and collapses space', () => {
  assert.equal(M.cleanText('  hi\u0000   there‮  ', 50), 'hi there');
  assert.equal(M.cleanText('abcdef', 3), 'abc');
});

import { deriveKey, newSalt, passwordProblem, KDF_ITERATIONS } from '../js/kdf.js';
import { b64urlEncode, b64urlDecode } from '../shared/b64.js';

test('kdf: matches the RFC 7914 PBKDF2-HMAC-SHA256 test vector', async () => {
  const salt = b64urlEncode(new TextEncoder().encode('salt'));
  const k = await deriveKey('password', salt, 1);
  const hex = [...b64urlDecode(k)].map((b) => b.toString(16).padStart(2, '0')).join('');
  assert.equal(hex, '120fb6cffcf8b32c43e7225256c4f837a86548c92ccc35480805987cb70be17b');
});

test('kdf: deterministic per salt, different across salts, 32 bytes, unicode-normalised', async () => {
  const s1 = newSalt(), s2 = newSalt();
  assert.equal(b64urlDecode(s1).length, 16);
  const a = await deriveKey('Correct Horse 9', s1, 1000);
  assert.equal(a, await deriveKey('Correct Horse 9', s1, 1000));
  assert.notEqual(a, await deriveKey('Correct Horse 9', s2, 1000));
  assert.notEqual(a, await deriveKey('Correct Horse 8', s1, 1000));
  assert.equal(b64urlDecode(a).length, 32);
  assert.equal(await deriveKey('é', s1, 1000), await deriveKey('é', s1, 1000), 'composed and decomposed accents match');
  assert.ok(KDF_ITERATIONS >= 300_000);
});

test('kdf: the password policy', () => {
  assert.ok(passwordProblem('short'));
  assert.ok(passwordProblem('password123'));
  assert.ok(passwordProblem('Tunde_99', 'tunde_99'));
  assert.ok(passwordProblem('aaaaaaaaaa'));
  assert.equal(passwordProblem('a-sensible-passphrase'), null);
});
