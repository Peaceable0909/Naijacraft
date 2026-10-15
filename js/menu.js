// The start screen: quick play, sign in, create account, password recovery, Google, and offline mode.
import { $ } from './game.js';
import { validateUsername } from '../shared/moderation.js';
import { passwordProblem } from './kdf.js';
import { renderGoogleButton } from './google.js';
import { solveCaptcha } from './captcha.js';
import { showRecoveryCode } from './dialog.js';
import { mountLookPicker } from './ui.js';
import { weeklyChallenge } from './achievements.js';

export const TIPS = [
  'Double-tap Space to fly. Hold Shift to go faster.',
  'Press E for blueprints: a bungalow, a Mama Put canteen, even a danfo.',
  'Press F on two corners, then G to fill that area with the block in your hand.',
  'Ctrl+Z undoes your last build. It remembers 100 steps.',
  'Your build code is a shareable link to your whole plot. Send it on WhatsApp.',
  'Watch out for the danfo on the ring road. Oshodi! Oshodi!',
  'Press B to dance. Other builders will see you.',
  'Night falls on Lagos every twenty minutes. Place lamps before it gets dark.',
  'Walk south past the last road to find Bar Beach.',
  'Press T for a third-person view and see your own outfit.',
  'Glass panes and iron fences join up with their neighbours by themselves.',
  'Press M to see the whole city and jump to any plot.',
];

const STORY = {
  bad_login: 'Wrong username or password.',
  rate_limited: 'Too many tries. Please wait a little and try again.',
};

export function createMenu({ server, auth, look, hooks }) {
  let info = null;
  let tipTimer = 0;
  const card = $('auth-card');
  const views = [...card.querySelectorAll('.view')];
  const err = $('menu-error');

  // ---------------------------------------------------------------- small helpers
  const setError = (t) => { err.textContent = t || ''; };
  let busyLabel = null;
  const setBusy = (t) => { busyLabel = t || null; $('menu-busy').classList.toggle('hidden', !t); if (t) $('menu-busy-text').textContent = t; };
  function showView(name) {
    for (const v of views) v.classList.toggle('hidden', v.dataset.view !== name);
    setError('');
  }
  function showTab(name) {
    for (const b of $('auth-tabs').querySelectorAll('button')) b.classList.toggle('on', b.dataset.tab === name);
    for (const p of card.querySelectorAll('.pane')) p.classList.toggle('hidden', p.dataset.pane !== name);
    setError('');
  }
  const message = (e) => STORY[e.code] || e.message || 'Something went wrong. Please try again.';

  async function humanCheck() {
    if (!info || !info.captcha || !info.turnstileSiteKey) return undefined;
    const label = busyLabel;
    setBusy(null);                                   // uncover the card so the check can be seen
    try { return await solveCaptcha($('menu-captcha'), info.turnstileSiteKey); } finally { setBusy(label); }
  }

  // Runs an account action, then joins the world. Errors are shown on the card instead of thrown.
  async function run(label, action) {
    setError('');
    setBusy(label);
    try {
      const result = await action();
      if (result === false) return;
      await hooks.enterOnline((t) => setBusy(t));
    } catch (e) {
      if (e && (e.code === 'auth' || e.status === 401) && auth.signedIn) { auth.signOut(); show(); }
      setError(message(e));
    } finally { setBusy(null); }
  }

  // ---------------------------------------------------------------- views
  function show() {
    if (!server) { showView('offline'); return; }
    if (auth.signedIn) {
      showView('back');
      $('wb-name').textContent = auth.user.name;
      $('wb-sub').textContent = auth.user.guest ? 'Playing as a guest. Add a password in the Account tab to keep your land safe.' : 'Signed in. Your land is waiting.';
    } else {
      showView('choose');
      showTab('guest');
    }
    $('play-offline').classList.toggle('hidden', !server);
    if (server && !info) setError("We can't reach the Naijacraft server right now. Check your internet, or play offline.");
  }

  async function refreshStats() {
    $('stat-online').textContent = '-'; $('stat-free').textContent = '-';
    if (!server) { $('menu-stats').classList.add('hidden'); return; }
    try {
      const r = await fetch(server + '/stats');
      if (!r.ok) return;
      const s = await r.json();
      $('stat-online').textContent = String(s.players);
      $('stat-free').textContent = String(s.freePlots);
    } catch { /* offline */ }
  }

  async function setupGoogle() {
    if (!info || !info.google || !info.googleClientId) return;
    const ok = await renderGoogleButton($('google-slot'), info.googleClientId, (credential) => run('Signing in with Google...', () => auth.google(credential)));
    $('google-wrap').classList.toggle('hidden', !ok);
  }

  // ---------------------------------------------------------------- wiring
  const pickers = [];
  const syncPickers = () => pickers.forEach((p) => p.render());
  pickers.push(mountLookPicker($('menu-look'), look, syncPickers));
  pickers.push(mountLookPicker($('offline-look'), look, syncPickers));

  $('auth-tabs').addEventListener('click', (e) => { const b = e.target.closest('button[data-tab]'); if (b) showTab(b.dataset.tab); });

  $('guest-play').addEventListener('click', () => run('Creating your guest pass...', async () => {
    const turnstile = await humanCheck();
    await auth.guest(turnstile);
  }));

  $('login-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = $('login-name').value.trim(), pass = $('login-pass').value;
    if (!name || !pass) return setError('Enter your username and password.');
    return run('Signing in...', () => auth.login(name, pass));
  });
  $('forgot-link').addEventListener('click', () => { showView('recover'); $('rec-name').value = $('login-name').value.trim(); });
  $('rec-back').addEventListener('click', show);

  // sign up, with live feedback
  let nameTimer = 0, nameSeq = 0;
  function checkSignupName() {
    const hint = $('signup-name-hint'), name = $('signup-name').value.trim();
    clearTimeout(nameTimer);
    hint.className = 'hint';
    if (!name) { hint.textContent = '3-16 letters, numbers or underscores.'; return; }
    const problem = validateUsername(name);
    if (problem) { hint.textContent = problem; hint.classList.add('bad'); return; }
    hint.textContent = 'Checking...';
    const seq = ++nameSeq;
    nameTimer = setTimeout(async () => {
      try {
        const r = await auth.checkName(name);
        if (seq !== nameSeq) return;
        hint.textContent = r.available ? 'Nice, that name is free.' : r.reason || 'That name is taken.';
        hint.className = 'hint ' + (r.available ? 'good' : 'bad');
      } catch { if (seq === nameSeq) hint.textContent = ''; }
    }, 380);
  }
  $('signup-name').addEventListener('input', checkSignupName);
  $('signup-pass').addEventListener('input', () => {
    const hint = $('signup-pass-hint'), p = $('signup-pass').value;
    const problem = p ? passwordProblem(p, $('signup-name').value) : null;
    hint.textContent = problem || (p ? 'Looks good.' : 'Easy to remember, hard to guess. A few words work well.');
    hint.className = 'hint ' + (problem ? 'bad' : p ? 'good' : '');
  });
  $('signup-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = $('signup-name').value.trim(), pass = $('signup-pass').value;
    const bad = validateUsername(name) || passwordProblem(pass, name);
    if (bad) return setError(bad);
    return run('Creating your account...', async () => {
      const turnstile = await humanCheck();
      setBusy('Creating your account...');
      const r = await auth.signup(name, pass, turnstile);
      setBusy(null);
      await showRecoveryCode(r.recovery);
    });
  });

  $('recover-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = $('rec-name').value.trim(), code = $('rec-code').value.trim(), pass = $('rec-pass').value;
    const bad = !name || !code ? 'Enter your username and recovery code.' : passwordProblem(pass, name);
    if (bad) return setError(bad);
    return run('Resetting your password...', async () => {
      const r = await auth.recover(name, code, pass);
      setBusy(null);
      await showRecoveryCode(r.recovery, 'Your password was reset. Here is a fresh recovery code. The old one no longer works.');
    });
  });

  $('wb-play').addEventListener('click', () => run('Joining Lagos...', async () => true));
  $('wb-switch').addEventListener('click', () => { auth.signOut(); show(); });

  $('play-offline').addEventListener('click', () => { showView('offline'); $('offline-name').focus(); });
  $('offline-play').addEventListener('click', () => {
    const name = $('offline-name').value.trim();
    const bad = validateUsername(name);
    if (bad) return setError(bad.replace('That name is reserved.', 'Please pick a different name.'));
    setError('');
    return hooks.enterOffline(name);
  });
  $('offline-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('offline-play').click(); });

  $('menu-challenge').textContent = weeklyChallenge();

  function startTips() {
    let i = Math.floor(Math.random() * TIPS.length);
    const set = () => { $('menu-tip').textContent = 'Tip: ' + TIPS[i++ % TIPS.length]; };
    set();
    clearInterval(tipTimer);
    tipTimer = setInterval(set, 7000);
  }

  return {
    // `serverInfo` is the /health reply, or null when the server can't be reached.
    open(serverInfo) {
      info = serverInfo;
      show();
      startTips();
      refreshStats();
      setupGoogle();
    },
    show, setBusy, setError, showView,
    close() { clearInterval(tipTimer); },
    setOfflineName(n) { $('offline-name').value = n || ''; },
  };
}
