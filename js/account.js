// The Account tab in the pause menu: upgrade a guest, rename, change password, link Google, sign out, delete.
import { $ } from './game.js';
import { validateUsername } from '../shared/moderation.js';
import { passwordProblem } from './kdf.js';
import { renderGoogleButton } from './google.js';
import { showDialog, showRecoveryCode, confirmDialog } from './dialog.js';
import { toast } from './ui.js';

export function createAccountPanel({ auth, getInfo }) {
  const busy = new Set();
  const once = async (key, fn) => {
    if (busy.has(key)) return;
    busy.add(key);
    try { await fn(); } catch (e) { toast(e.message || 'Something went wrong. Please try again.', 'bad'); } finally { busy.delete(key); }
  };
  const restart = (message) => { toast(message); setTimeout(() => location.reload(), 1400); };

  function render() {
    const u = auth.user;
    if (!u) return;
    const box = $('acct-summary');
    box.innerHTML = '';
    const av = document.createElement('div'); av.className = 'avatar'; av.textContent = u.name.slice(0, 1).toUpperCase();
    const who = document.createElement('div');
    const b = document.createElement('b'); b.textContent = u.name;
    const small = document.createElement('small');
    small.textContent = u.guest ? 'Guest account' : [u.hasPassword ? 'Password' : null, u.hasGoogle ? 'Google' : null].filter(Boolean).join(' + ') + ' sign-in';
    who.append(b, small);
    box.append(av, who);
    $('acct-guest').classList.toggle('hidden', !u.guest);
    $('acct-rename').classList.toggle('hidden', u.guest);
    $('acct-password').classList.toggle('hidden', !u.hasPassword);
    const info = getInfo();
    const canLink = !!(info && info.google && info.googleClientId && !u.hasGoogle && !u.guest);
    $('acct-google').classList.toggle('hidden', !canLink);
    if (canLink) {
      renderGoogleButton($('google-link-slot'), info.googleClientId, (credential) => once('link', async () => {
        await auth.linkGoogle(credential);
        toast('Google account linked!');
        render();
      }), 'continue_with');
    }
  }

  $('upgrade-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = $('up-name').value.trim(), pass = $('up-pass').value;
    const bad = validateUsername(name) || passwordProblem(pass, name);
    if (bad) return toast(bad, 'bad');
    return once('upgrade', async () => {
      const r = await auth.upgrade(pass, name);
      await showRecoveryCode(r.recovery);
      restart('Account saved! Restarting the game...');
    });
  });

  $('rename-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = $('rn-name').value.trim();
    const bad = validateUsername(name);
    if (bad) return toast(bad, 'bad');
    return once('rename', async () => {
      if (!(await confirmDialog('Change username?', `Your name will change to ${name}. You can only do this a few times.`, 'Change it'))) return;
      await auth.rename(name);
      restart('Username changed! Restarting the game...');
    });
  });

  $('cp-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const oldP = $('cp-old').value, newP = $('cp-new').value;
    const bad = !oldP ? 'Enter your current password.' : passwordProblem(newP, auth.user.name);
    if (bad) return toast(bad, 'bad');
    return once('password', async () => {
      await auth.changePassword(oldP, newP);
      $('cp-old').value = ''; $('cp-new').value = '';
      toast('Password changed. Your other devices were signed out.');
    });
  });

  $('acct-signout').addEventListener('click', () => { auth.signOut(); location.reload(); });
  $('acct-signout-all').addEventListener('click', () => once('logout', async () => {
    if (!(await confirmDialog('Sign out everywhere?', 'Every device signed in to this account will be signed out, including this one.', 'Sign out'))) return;
    await auth.signOutEverywhere();
    location.reload();
  }));

  $('acct-delete').addEventListener('click', () => once('delete', async () => {
    const u = auth.user;
    const input = document.createElement('input');
    input.type = 'password'; input.placeholder = 'Your password'; input.autocomplete = 'current-password';
    const text = document.createElement('p');
    text.textContent = 'This permanently deletes your account, your plot and everything you built. It cannot be undone.' + (u.hasPassword ? ' Enter your password to confirm.' : '');
    const body = [text]; if (u.hasPassword) body.push(input);
    const pick = await showDialog({ title: 'Delete your account?', body, actions: [{ id: 'no', label: 'Keep my account' }, { id: 'yes', label: 'Delete everything', danger: true }] });
    if (pick !== 'yes') return;
    await auth.deleteAccount(input.value);
    restart('Your account was deleted. Goodbye, and thanks for building with us.');
  }));

  return { render };
}
