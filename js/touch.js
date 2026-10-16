// On-screen controls for phones and tablets: a move stick, drag-to-look and action buttons.
export function createTouchControls(root, handlers) {
  root.innerHTML = `
    <div class="t-stick" id="t-stick"><div class="t-knob" id="t-knob"></div></div>
    <div class="t-look" id="t-look"></div>
    <div class="t-buttons">
      <button class="t-btn" data-act="break" aria-label="Break">⛏</button>
      <button class="t-btn big" data-act="place" aria-label="Place">▣</button>
      <button class="t-btn" data-act="jump" aria-label="Jump">⤒</button>
      <button class="t-btn" data-act="down" aria-label="Down">⤓</button>
    </div>
    <div class="t-top">
      <button class="t-btn small" data-act="fly">Fly</button>
      <button class="t-btn small" data-act="view">View</button>
      <button class="t-btn small" data-act="inventory">Blocks</button>
      <button class="t-btn small" data-act="chat">Chat</button>
      <button class="t-btn small" data-act="emote">Emote</button>
      <button class="t-btn small" data-act="map">Map</button>
      <button class="t-btn small" data-act="pause">☰</button>
    </div>`;
  const state = { f: 0, s: 0, jump: false, down: false, place: false, break: false };
  const stick = root.querySelector('#t-stick'), knob = root.querySelector('#t-knob'), look = root.querySelector('#t-look');
  let stickId = null, lookId = null, sx = 0, sy = 0, lx = 0, ly = 0;

  stick.addEventListener('touchstart', (e) => {
    e.preventDefault();
    const t = e.changedTouches[0]; stickId = t.identifier;
    const r = stick.getBoundingClientRect(); sx = r.left + r.width / 2; sy = r.top + r.height / 2;
    moveStick(t);
  }, { passive: false });
  const moveStick = (t) => {
    const R = stick.clientWidth / 2;
    let dx = t.clientX - sx, dy = t.clientY - sy;
    const d = Math.hypot(dx, dy);
    if (d > R) { dx = dx / d * R; dy = dy / d * R; }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    state.s = dx / R; state.f = -dy / R;
  };
  look.addEventListener('touchstart', (e) => {
    e.preventDefault();
    const t = e.changedTouches[0]; lookId = t.identifier; lx = t.clientX; ly = t.clientY;
  }, { passive: false });
  root.addEventListener('touchmove', (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === stickId) { e.preventDefault(); moveStick(t); }
      if (t.identifier === lookId) { e.preventDefault(); handlers.look(t.clientX - lx, t.clientY - ly); lx = t.clientX; ly = t.clientY; }
    }
  }, { passive: false });
  const end = (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === stickId) { stickId = null; state.f = state.s = 0; knob.style.transform = ''; }
      if (t.identifier === lookId) lookId = null;
    }
  };
  root.addEventListener('touchend', end);
  root.addEventListener('touchcancel', end);

  root.querySelectorAll('.t-btn').forEach((b) => {
    const act = b.dataset.act;
    b.addEventListener('touchstart', (e) => {
      e.preventDefault(); b.classList.add('on');
      if (act in state) state[act] = true;
      handlers.press(act);
    }, { passive: false });
    const up = (e) => { e.preventDefault(); b.classList.remove('on'); if (act in state) state[act] = false; handlers.release?.(act); };
    b.addEventListener('touchend', up, { passive: false });
    b.addEventListener('touchcancel', up, { passive: false });
  });
  return state;
}
