// Local persistence (Phase 1). Phase 2 swaps this for cloud saves keyed by the signed-in account.
const NS = 'naijacraft:v1:';

function read(key, fallback) {
  try { const v = localStorage.getItem(NS + key); return v === null ? fallback : JSON.parse(v); } catch { return fallback; }
}
function write(key, value) {
  try { localStorage.setItem(NS + key, JSON.stringify(value)); return true; } catch { return false; }
}
function remove(key) { try { localStorage.removeItem(NS + key); } catch { /* ignore */ } }

export const storage = {
  loadProfile: () => read('profile', null),
  saveProfile: (p) => write('profile', p),
  loadSettings: () => ({ viewChunks: 10, resolution: 1, sensitivity: 1, volume: 0.7, freezeTime: false, weather: 'auto', ...read('settings', {}) }),
  saveSettings: (s) => write('settings', s),
  // Plot saves: { v: 2, d: base64 }. Prototype saves were a bare base64 string under 'plot:<n>'.
  loadPlot(number) {
    const v2 = read('plot2:' + number, null);
    if (v2 && v2.v === 2 && typeof v2.d === 'string') return { version: 2, data: v2.d };
    const v1 = read('plot:' + number, null);
    if (typeof v1 === 'string') return { version: 1, data: v1 };
    return null;
  },
  savePlot(number, b64) {
    const ok = write('plot2:' + number, { v: 2, d: b64 });
    if (ok) remove('plot:' + number);
    return ok;
  },
  clearPlot(number) { remove('plot2:' + number); remove('plot:' + number); },
};
