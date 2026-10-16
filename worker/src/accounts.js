// Durable Object that owns every account. One global instance, addressed by name from the Worker.
import { DurableObject } from 'cloudflare:workers';
import { AccountsCore } from './accounts-core.js';

const METHODS = new Set([
  'guest', 'check', 'prelogin', 'signup', 'login', 'google', 'refresh', 'me', 'upgrade', 'linkGoogle', 'rename',
  'changePassword', 'recover', 'logoutAll', 'deleteAccount', 'verify', 'adminLookup', 'adminBan', 'stats',
]);

export class Accounts extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.core = new AccountsCore({ sql: ctx.storage.sql, env });
  }

  // One RPC entry point keeps the surface small and easy to audit.
  async call(method, args) {
    if (!METHODS.has(method)) throw new Error('unknown method');
    return this.core[method](args || {});
  }
}
