# Putting Naijacraft online (free)

This guide takes you from "I have the code" to "my friends are building in my Lagos". It assumes you have never used
Cloudflare. Allow about 15 minutes. You do not need a credit card.

**What you will have at the end:** one address, like `https://naijacraft-world.yourname.workers.dev`, that serves the
game *and* the server behind it. Share that link.

> **Not ready for a server yet?** The game also works with no server at all (offline mode, saves on one device). Host
> the static files anywhere (GitHub Pages, Cloudflare Pages, Netlify). Everything below is only needed for online play.

## 1. What you need

- A free **Cloudflare account**: <https://dash.cloudflare.com/sign-up>
- **Node.js 20 or newer**: <https://nodejs.org> (the "LTS" download is fine)
- This repository on your computer (`git clone` or download the ZIP)

## 2. Deploy

Open a terminal in the project folder and run:

```sh
cd worker
npm install
npx wrangler login        # opens your browser; click "Allow"
npm run deploy
```

The first deploy asks you to pick a free `workers.dev` name (for example `yourname`). When it finishes it prints the
address of your game:

```
https://naijacraft-world.yourname.workers.dev
```

Open it. You should see the Naijacraft start screen with the **Quick play / Sign in / Create account** card, and
"builders online" and "plots free" counters. That is it: the server is live.

`npm run deploy` does two things: it copies the browser game into `worker/public` (static files, free and unlimited)
and uploads the Worker plus its two Durable Objects (the account database and the world).

To update later, pull the new code and run `npm run deploy` again. Players' lands and accounts are kept.

## 3. Recommended: two secrets (1 minute)

Secrets are private values stored by Cloudflare, never in the code.

```sh
cd worker
npx wrangler secret put AUTH_PEPPER      # paste a long random string (32+ characters)
npx wrangler secret put ADMIN_TOKEN      # paste a different long random string
```

- `AUTH_PEPPER` makes stolen account data much harder to crack. Set it **before** people sign up: changing it later
  invalidates every password and recovery code.
- `ADMIN_TOKEN` switches on the moderation tools in section 6. Keep it to yourself.

To make a random string: `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`

## 4. Optional: sign in with Google

1. Go to <https://console.cloud.google.com/apis/credentials> and create a project if you do not have one.
2. Configure the **OAuth consent screen** (External; app name "Naijacraft"; your email).
3. **Create credentials → OAuth client ID → Web application.**
   Under *Authorized JavaScript origins* add your game address (`https://naijacraft-world.yourname.workers.dev`) and,
   for local testing, `http://localhost:8787`. You do not need a client secret or redirect URI.
4. Copy the **Client ID** (it ends in `.apps.googleusercontent.com`) into `worker/wrangler.toml`:

   ```toml
   GOOGLE_CLIENT_ID = "1234567890-abc.apps.googleusercontent.com"
   ```
5. `npm run deploy` again. A "Continue with Google" button now appears on the start screen.

Naijacraft only reads Google's anonymous account id. It never sees a name, email or photo.

## 5. Optional: a human check on sign-up (Cloudflare Turnstile)

Useful if strangers start creating thousands of guest accounts.

1. Cloudflare dashboard → **Turnstile → Add site**. Choose *Managed*, add your game's hostname.
2. Put the **site key** in `worker/wrangler.toml` as `TURNSTILE_SITE_KEY = "..."`.
3. Run `npx wrangler secret put TURNSTILE_SECRET` and paste the **secret key**.
4. `npm run deploy`.

## 6. Moderating your world

Set `ADMIN_TOKEN` (section 3), then use these from any terminal. Replace `$SITE` with your game address and
`$TOKEN` with your token.

```sh
SITE=https://naijacraft-world.yourname.workers.dev
TOKEN=your-admin-token
auth="Authorization: Bearer $TOKEN"

curl -H "$auth" $SITE/admin/summary                         # players online, plots taken, accounts
curl -H "$auth" $SITE/admin/players                         # who is in the world right now
curl -H "$auth" "$SITE/admin/reports?limit=20"              # player reports, with the reported player's recent chat
curl -H "$auth" "$SITE/admin/lookup?name=SomeBuilder"       # account details (never passwords)

curl -H "$auth" -d '{"text":"Server restarts in 5 minutes"}' $SITE/admin/announce
curl -H "$auth" -d '{"name":"SomeBuilder"}' $SITE/admin/kick       # disconnect now
curl -H "$auth" -d '{"name":"SomeBuilder"}' $SITE/admin/ban        # ban the account
curl -H "$auth" -d '{"name":"SomeBuilder"}' $SITE/admin/unban
curl -H "$auth" -d '{"plot":27}' $SITE/admin/release               # take a plot back (erases it)
curl -H "$auth" $SITE/admin/export > naijacraft-backup.json        # every plot, as JSON, for your own backups
```

You can also add words to block in names and chat with `BLOCKED_WORDS` in `wrangler.toml` (comma separated).
Players can mute and report each other from the *Players* list (press `Tab`).

## 7. Optional: host the game files somewhere else

By default the Worker serves the game and the API from one address, which is the simplest setup. If you would rather
host the static files on GitHub Pages, Cloudflare Pages or Netlify:

1. Edit `js/config.js` and set `DEFAULT_SERVER = 'https://naijacraft-world.yourname.workers.dev'`.
   (For a quick test you can also open the page with `?server=https://...`; the browser remembers it.)
2. In `worker/wrangler.toml` set `ALLOWED_ORIGINS` to the address of your static site, for example
   `"https://yourname.github.io"`, and run `npm run deploy`. Leave it as `"*"` if you do not mind other sites using your
   server.

## 8. Optional: deploy automatically from GitHub

The repository contains `.github/workflows/deploy.yml`. To use it:

1. Cloudflare dashboard → *My Profile → API Tokens → Create Token → "Edit Cloudflare Workers"* template. Copy the token.
2. In your GitHub repository: *Settings → Secrets and variables → Actions → New repository secret*:
   `CLOUDFLARE_API_TOKEN` (the token) and `CLOUDFLARE_ACCOUNT_ID` (shown on the right of your Cloudflare dashboard home).
3. Push to `main`, or run the workflow from the *Actions* tab. It runs the tests first, then deploys.

## 9. Running costs and limits

Naijacraft is designed to cost **$0** on Cloudflare's free plan. The numbers below are Cloudflare's published free
limits at the time of writing; check <https://developers.cloudflare.com/durable-objects/platform/pricing/> for the
latest.

| Resource | Free allowance | What uses it |
| --- | --- | --- |
| Static files (the game) | unlimited | page loads |
| Durable Object requests | 100,000 per day | every incoming WebSocket message counts as 1/20 of a request; sign-in calls count as 1 |
| Durable Object duration | 13,000 GB-seconds per day | the world is awake while anyone is playing (enough for all day) |
| SQLite storage | 5 GB | accounts and plots (a plot is a few KB compressed) |
| Worker CPU | 10 ms per request | why passwords are stretched in the browser, not on the server |

A moving player sends about 5 small messages per second, a standing one almost none (heartbeats are free). That works
out to **roughly 100 to 350 player-hours per day** before the daily request allowance runs out: comfortably a few dozen
regular players. When the allowance runs out the server pauses until the next day; the game files still load and
**offline mode keeps working**. If you outgrow it, the Workers Paid plan starts at $5 per month and includes far higher limits.

Cloudflare also shows live usage under *Workers & Pages → naijacraft-world → Metrics*.

## 10. Troubleshooting

| Problem | Try |
| --- | --- |
| The start screen says "Offline mode" | The page could not reach the server. Open `https://your-address/health`: it should show `{"ok":true,...}`. If you host the files elsewhere, check section 7. |
| "Origin not allowed" | `ALLOWED_ORIGINS` does not include the site the page is served from (section 7). |
| Google button missing | `GOOGLE_CLIENT_ID` is empty or you forgot to redeploy; the address must be listed under *Authorized JavaScript origins*. |
| `wrangler deploy` complains about migrations | Do not rename the `World` or `Accounts` classes after the first deploy; add a new migration instead. |
| Players cannot join at the end of the day | The free request allowance is used up (section 9). |

Everything about how the server works is in [ARCHITECTURE.md](ARCHITECTURE.md).
