// Cloudflare Turnstile ("are you human?"). Only used when the server turns it on (captcha: true in /health).
let loading = null;

function load() {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (!loading) {
    loading = new Promise((resolve) => {
      const s = document.createElement('script');
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      s.async = true;
      s.onload = () => resolve(window.turnstile || null);
      s.onerror = () => { loading = null; resolve(null); };
      document.head.appendChild(s);
    });
  }
  return loading;
}

// Resolves with a Turnstile token, shown inside `container` while the check runs. Rejects if it fails.
export async function solveCaptcha(container, siteKey) {
  const ts = await load();
  if (!ts) throw new Error('The human check could not load. Check your connection or disable content blockers.');
  container.classList.remove('hidden');
  container.innerHTML = '';
  return new Promise((resolve, reject) => {
    const done = (fn, v) => { container.classList.add('hidden'); fn(v); };
    const timer = setTimeout(() => done(reject, new Error('The human check timed out. Please try again.')), 60000);
    ts.render(container, {
      sitekey: siteKey, theme: 'dark',
      callback: (token) => { clearTimeout(timer); done(resolve, token); },
      'error-callback': () => { clearTimeout(timer); done(reject, new Error('The human check failed. Please try again.')); },
    });
  });
}
