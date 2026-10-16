// Waits for the 3D engine (loaded from a CDN with a fallback, see index.html), then starts the game.
const ready = await window.__babylonReady;
if (!ready || !window.BABYLON) {
  document.getElementById('loading').classList.add('hidden');
  document.getElementById('fatal-text').textContent = 'The 3D engine (Babylon.js) failed to load. Check your internet connection and refresh the page.';
  document.getElementById('fatal').classList.remove('hidden');
} else {
  try {
    await import('./main.js');
  } catch (e) {
    console.error(e);
    document.getElementById('loading').classList.add('hidden');
    document.getElementById('fatal-text').textContent = 'Something went wrong while starting: ' + (e && e.message ? e.message : e);
    document.getElementById('fatal').classList.remove('hidden');
  }
}
