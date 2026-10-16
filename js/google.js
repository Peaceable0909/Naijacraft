// Google Sign-In (Google Identity Services). Only used when the server reports a GOOGLE_CLIENT_ID in /health.
let loading = null;
let handler = null;
let initialisedFor = null;

function load() {
  if (window.google && window.google.accounts && window.google.accounts.id) return Promise.resolve(window.google);
  if (!loading) {
    loading = new Promise((resolve) => {
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true;
      s.onload = () => resolve(window.google || null);
      s.onerror = () => { loading = null; resolve(null); };
      document.head.appendChild(s);
    });
  }
  return loading;
}

// Draws Google's button into `el`. onCredential(idToken) is called after the player picks an account.
// Resolves to false when Google's script can't be loaded (for example when it is blocked).
export async function renderGoogleButton(el, clientId, onCredential, text = 'signin_with') {
  const g = await load();
  if (!g) return false;
  handler = onCredential;
  if (initialisedFor !== clientId) {
    g.accounts.id.initialize({ client_id: clientId, callback: (resp) => handler && handler(resp.credential), auto_select: false, ux_mode: 'popup' });
    initialisedFor = clientId;
  }
  el.innerHTML = '';
  g.accounts.id.renderButton(el, { theme: 'filled_black', size: 'large', shape: 'pill', text, width: Math.min(300, el.clientWidth || 300) });
  return true;
}
