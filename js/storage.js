// Local persistence: settings and the cosmetic profile always live in this browser. Plots are only stored here in offline
// mode; online, the server keeps them.
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
  loadSettings: () => ({ viewChunks: 10, resolution: 1, sensitivity: 1, volume: 0.7, freezeTime: false, weather: 'auto', quality: 'auto', ...read('settings', {}) }),
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
  // The offline plot is number 28. Saves from the Phase 1 prototype lived under plot 6, so adopt those once.
  loadOfflinePlot(number, legacyNumber = 6) {
    return this.loadPlot(number) || this.loadPlot(legacyNumber);
  },
  loadMutes: () => { const m = read('mutes', []); return Array.isArray(m) ? m.filter((x) => typeof x === 'string').slice(0, 200) : []; },
  saveMutes: (list) => write('mutes', list.slice(0, 200)),
};
