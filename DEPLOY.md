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

### Redeploy

**Deployments** → **…** on the newest one → **Redeploy**. Environment variables
only take effect on a new build.

### What happens next

`vercel.json` already schedules all three jobs:

- **14:45 UTC, weekdays** — record that day's flip level and magnet strikes
- **21:30 UTC, weekdays** — pull the session's high and low, and score it
- **22:00 UTC, weekdays** — recompute the `/groups` scores and breadth

Both times were picked to sit inside the trading session in **both** summer and
winter, since Vercel cron schedules are UTC and New York is not.

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
