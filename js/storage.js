// Local persistence (Phase 1). Phase 2 swaps this for cloud saves keyed by the signed-in account.
const NS = 'naijacraft:v1:';

function read(key, fallback) {
  try { const v = localStorage.getItem(NS + key); return v === null ? fallback : JSON.parse(v); } catch { return fallback; }
}
function write(key, value) {
  try { localStorage.setItem(NS + key, JSON.stringify(value)); return true; } catch { return false; }
}

export const storage = {
  loadProfile: () => read('profile', null),
  saveProfile: (p) => write('profile', p),
  loadSettings: () => ({ viewChunks: 10, resolution: 1, sensitivity: 1, ...read('settings', {}) }),
  saveSettings: (s) => write('settings', s),
  loadPlot: (number) => read('plot:' + number, null),
  savePlot: (number, b64) => write('plot:' + number, b64),
  clearPlot: (number) => { try { localStorage.removeItem(NS + 'plot:' + number); } catch { /* ignore */ } },
};
