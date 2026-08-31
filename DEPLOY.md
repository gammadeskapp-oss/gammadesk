# Deploying GammaDesk

A step-by-step walkthrough, written assuming you have not done this before.
Nothing here costs money — GitHub and Vercel both have free tiers that cover
this app comfortably.

There are two stages:

1. **Get the code onto GitHub** — a backup of your code that Vercel can read.
2. **Connect Vercel to GitHub** — Vercel builds and hosts the site.

> **You do not need an API key.** GammaDesk pulls its option chain from Cboe's
> free public feed, which needs no account and no key. There is nothing to
> configure — importing the repo and clicking Deploy is the whole job.
>
> Stage 3 below is only relevant if you later switch to a paid Polygon plan.

---

## Before you start: Node.js

You need Node.js **20.9 or newer**. Check:

```bash
node --version
```

If that shows something older (for example `v12.13.1`), install the current LTS:

```bash
winget install OpenJS.NodeJS.LTS
```

Then **close and reopen your terminal** and check `node --version` again. This
matters for running the app on your own machine; Vercel uses its own modern Node
regardless.

---

## Stage 1 — Get the code onto GitHub

### 1.1 Tell git who you are

Git stamps your name on every save. Run these once (use your own name and the
email on your GitHub account):

```bash
git config --global user.name "Your Name"
```

```bash
git config --global user.email "you@example.com"
```

### 1.2 Create the repository on GitHub

Go to <https://github.com/new> and fill in:

- **Repository name**: `gammadesk`
- **Description**: optional
- **Public or Private**: either works. Vercel can deploy both.
- **Do NOT tick** "Add a README file", "Add .gitignore", or "Choose a license".
  The project already has those, and ticking them creates a conflict you would
  then have to untangle.

Click **Create repository**.

GitHub then shows you a page with some commands. Ignore them — the next step
covers it.

### 1.3 Connect your local folder to it

In your terminal, in the `gammadesk` folder. Replace `YOUR-USERNAME` with your
actual GitHub username:

```bash
git remote add origin https://github.com/YOUR-USERNAME/gammadesk.git
```

### 1.4 Push the code up

```bash
git push -u origin main
```

The first time, a browser window or a prompt will ask you to sign in to GitHub.
Do that, and the upload will finish.

> **If it asks for a password in the terminal**: GitHub stopped accepting account
> passwords for this in 2021. Either let the browser sign-in flow handle it, or
> create a Personal Access Token at
> <https://github.com/settings/tokens> and paste that as the password.

Refresh your repository page on GitHub — your files should be there.

> **Check before you continue:** you should see `README.md`, `src/`,
> `package.json` — and you should **NOT** see `.env.local`. That file holds your
> API key and is deliberately excluded by `.gitignore`. If you do see it, stop
> and tell me.

---

## Stage 2 — Connect it to Vercel

### 2.1 Sign up

Go to <https://vercel.com/signup> and choose **Continue with GitHub**. Signing up
this way means Vercel can see your repositories, which is what you want.

### 2.2 Import the project

1. Go to <https://vercel.com/new>.
2. You will see a list of your GitHub repositories. Find **gammadesk** and click
   **Import**.
   - If it is not listed, click **Adjust GitHub App Permissions** and grant
     Vercel access to the repo.

### 2.3 Check the settings

Vercel recognises Next.js on its own. You should see:

- **Framework Preset**: `Next.js`
- **Build Command**: `next build` (or "default")
- **Output Directory**: default
- **Root Directory**: `./`

Leave all of it alone.

### 2.4 Environment variables — skip this

There is nothing to add. Leave the **Environment Variables** section empty.

### 2.5 Deploy

Click **Deploy** and wait a couple of minutes. When it finishes you get a URL
like `gammadesk-abc123.vercel.app`. Click it — that is your live dashboard.

---

## Stage 3 — Switching to Polygon later (optional)

Only if you take out a **paid** Polygon options plan. The free plan cannot power
this dashboard: it does not expose open interest, which every number here is
built from, and its options snapshot endpoints return `403 NOT_AUTHORIZED`.

1. Open your project on <https://vercel.com/dashboard>.
2. **Settings** → **Environment Variables**.
3. Add two variables, ticking **Production**, **Preview** and **Development**
   for each:

   | Key | Value |
   |-----|-------|
   | `GAMMADESK_DATA_SOURCE` | `polygon` |
   | `POLYGON_API_KEY` | your Polygon key |

4. Click **Save**.

**Environment variables only take effect on a new build.** So then:

5. Go to the **Deployments** tab.
6. On the most recent deployment, click the **…** menu → **Redeploy**.

The data-quality strip at the bottom of the page shows which source is live.

---

## Stage 3b — Turning on the Accuracy Log

The `/log` page needs two one-time setup steps. Until you do these it still
loads, but nothing gets recorded.

### Create somewhere durable to store it

Vercel wipes the filesystem on every deploy, so the log has to live outside it.

1. Vercel dashboard → your project → **Storage** tab.
2. **Create Database** → choose **Blob** → name it anything → **Create**.
3. Make sure it is **connected to the gammadesk project** (Vercel usually does
   this automatically and adds a `BLOB_READ_WRITE_TOKEN` variable for you).

This is on the free tier. Two small JSON files live here: the accuracy log and
the `/groups` snapshot.

> Vercel's Hobby plan allows a limited number of cron jobs. If it refuses the
> third one, drop `/api/groups/refresh` from `vercel.json` — `/groups` still
> works, it just recomputes itself on the first visit of the day instead of
> being refreshed ahead of time.

### Add a cron secret

The two scheduled jobs write to storage, so they must not be callable by
anyone who guesses the URL.

1. **Settings** → **Environment Variables** → **Add New**.
2. Key: `CRON_SECRET`. Value: a long random string — mash the keyboard, or use
   a password generator. Nobody needs to remember it.
3. Tick **Production**, **Preview** and **Development** → **Save**.

Vercel sends this automatically as a bearer token when it runs the jobs.
Without it the endpoints return a 503 and refuse to do anything, which is the
safe default.

### Optional — Discord digest

To have the daily summary posted to a Discord channel, add one more variable:

| Key | Value |
|-----|-------|
| `DISCORD_WEBHOOK_URL` | your channel's webhook URL |

In Discord: **Server Settings → Integrations → Webhooks → New Webhook**, pick
the channel, then **Copy Webhook URL**.

> Treat that URL as a password. Anyone who has it can post to that channel. It
> is only ever read on the server and is never sent to the browser.

Leave it unset and the digest is still generated and shown at `/digest` — it
just is not delivered anywhere.

### Redeploy

**Deployments** → **…** on the newest one → **Redeploy**. Environment variables
only take effect on a new build.

### What happens next

`vercel.json` schedules the jobs:

| Job | UTC | EDT (summer) | EST (winter) |
|-----|-----|--------------|--------------|
| `/api/scanner/gamma` — refresh gamma for scanner candidates | 12:30 **and** 13:30 | 08:30 | 08:30 |
| `/api/scanner/run` — run the morning scan | 13:35 **and** 14:35 | 09:35 | 09:35 |
| `/api/log/snapshot` — record the day's flip level and magnets | 14:45 | 10:45 | 09:45 |
| `/api/log/settle` — score it against the session's high and low | 21:15 | 17:15 | **16:15** |
| `/api/flow/refresh` — rescan chains for unusual activity | 21:40 | 17:40 | 16:40 |
| `/api/groups/refresh` — recompute group scores and breadth | 22:00 | 18:00 | 17:00 |
| `/api/digest` — build the digest and post it to Discord | 22:20 | 18:20 | 17:20 |

### Why the log needs two jobs, not one

It is tempting to do the whole thing once after the close. That would break it.

The **snapshot** records a prediction — where the gamma flip and the magnet
strikes are — and it has to be taken *while the session is still running*.
Recording it after the close and then scoring it against the day that just
finished would be scoring a forecast made with knowledge of the answer. The
number would look excellent and mean nothing.

So: snapshot in the morning, settle after the close.

### Why the times are UTC and drift

Vercel cron schedules are UTC, and New York is not. A single fixed UTC time
cannot be "4:15pm ET" all year — it lands an hour earlier in summer. The settle
job is set to **21:15 UTC**, which is 4:15pm ET in winter and 5:15pm ET in
summer. Both are safely after the 4pm close, which is the part that actually
matters. Anything earlier would fire *before* the close during winter.

Both times were picked to sit inside the trading session in **both** summer and
winter, since Vercel cron schedules are UTC and New York is not.

### Why the two scanner jobs are registered twice

The scanner has no such slack. 08:30 ET is chosen because open interest has
just published, and 09:35 ET because it is five minutes after the open — an
hour of winter drift would run the scan *before the market opened*.

So each scanner job is registered at **both** candidate UTC times, and both
entries carry `?when=scheduled`. The route checks the actual New York clock and
runs only when it reads the configured time; the other entry fires, sees the
wrong hour, and returns without spending a single upstream request. The whole
year is covered without either job drifting.

The same guard refuses a run delayed past twenty minutes rather than running it
late — a scan that ran at 10:30 but published under a 09:35 heading would be a
false statement about when its VWAP readings were taken. On Vercel's free plan
crons can be delayed by up to an hour, so **the scanner wants the Pro plan** or
it will regularly refuse. Either way you can re-run a missed morning by hand:

```
curl "https://your-site/api/scanner/gamma?token=$CRON_SECRET&format=text"
curl "https://your-site/api/scanner/run?token=$CRON_SECRET&format=text"
```

Both return a single readable line — `Refreshed 51 chains, 2 failed. SPY gamma
positive.` — which is the point of `format=text`. Neither is linked anywhere in
the UI, and both need `CRON_SECRET`. Run the gamma job first; the scan reads
what it stored.

### Why the breadth and level-feed jobs are registered differently

`/api/breadth/refresh` and `/api/retest/refresh` run **every minute while the
market is open**, which is a different problem from the fixed-time jobs above.
There is no single clock time for them to land on, so the dual-registration
trick does not apply and neither carries a drift guard — a sample that arrives
two minutes late is still a perfectly good sample, and it stamps itself with
the time it was actually taken rather than the time it was due.

What they do share is the New York clock check. Each is registered once over
`13-21` UTC, a span wide enough to contain 09:30–16:00 New York under either
daylight-saving offset, and the route decides which of those firings are really
inside the session. Everything outside returns immediately without spending an
upstream request.

The level feed is also safe to miss. Each level's state is stored and advanced
bar by bar, so a run that skips five minutes simply folds in the five minutes
of bars it had not seen. Nothing is lost and nothing is double-counted.

Both need `TRADIER_TOKEN` to be at their cheapest — see `.env.example`. Without
it they fall back to Yahoo and still work, using more requests. You can run
either by hand:

```
curl "https://your-site/api/breadth/refresh?token=$CRON_SECRET&force=1"
curl "https://your-site/api/retest/refresh?token=$CRON_SECRET&force=1"
```

`force=1` bypasses the market-hours check, which is how you test them out of
session.

You do not need to do anything else. The first row appears on the next weekday
run, and the running percentages become meaningful after a couple of weeks.

> On Vercel's free plan cron jobs can be delayed by up to an hour. That is fine
> here — both jobs have an hour of slack before they would fall outside the
> window they care about, and the settle job re-checks any day it missed.

---

## Stage 4 — Pointing gammadesk.app at it

Once you own the domain:

1. Project → **Settings** → **Domains**.
2. Type `gammadesk.app`, click **Add**.
3. Vercel shows you DNS records to create. Where you do this depends on where
   you bought the domain:
   - **Bought through Vercel** — nothing to do, it configures itself.
   - **Bought elsewhere** (Namecheap, Cloudflare, GoDaddy…) — log in there, find
     the DNS settings, and add the exact records Vercel shows you. Usually an
     `A` record for the root and a `CNAME` for `www`.
4. Wait. DNS changes can take anywhere from a few minutes to a few hours.
   Vercel's Domains page shows a green tick when it is live, and issues the
   HTTPS certificate automatically.

---

## Making changes later

Vercel watches your GitHub repo. Any push to `main` deploys automatically:

```bash
git add .
```

```bash
git commit -m "Describe what you changed"
```

```bash
git push
```

That is the whole loop. Watch it build in the Vercel dashboard.

---

## Troubleshooting

**Yellow "SAMPLE DATA" badge on the live site**
The app could not reach real data, so it fell back to generated numbers rather
than showing an empty page or wrong ones. The reason is printed at the bottom of
the page in the data-quality strip — read that first.

**"Could not reach the Cboe delayed-quote service"**
The public feed is undocumented and has no SLA, so it can fail or change without
notice. Usually temporary. If it persists, the feed may have moved.

**"Polygon rejected the request (HTTP 403)"**
Your Polygon plan does not include the options snapshot endpoint. The free plan
never does. Either upgrade, or set `GAMMADESK_DATA_SOURCE=cboe` (the default)
and redeploy.

**"Polygon rate limit hit (HTTP 429)"**
The free plan allows 5 requests per minute. The app caches for 30 minutes to
stay under that, but you can still trip it by redeploying repeatedly. Wait a
minute.

**Build fails on Vercel**
Open the failed deployment and read the build log — the actual error is in
there. If it mentions a Node version, `package.json` already declares
`"engines": { "node": ">=20.9.0" }`; confirm the Vercel project is set to Node
22 or newer under **Settings → General → Node.js Version**.

**I accidentally committed my API key**
Treat the key as compromised: go to
<https://polygon.io/dashboard/api-keys>, revoke it, and generate a new one.
Removing the file from the repo is not enough on its own — the old value stays
in the git history.
