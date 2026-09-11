# Setup

This is a self-contained deployment. Everything below is done once, and most of
it is pasting keys into a dashboard. Budget an hour.

An AI coding assistant can carry out these steps for you — point it at this file
and at `AGENTS.md`, which holds the rules for changing the code itself.

## What this is

A video production tool with two halves that share one project:

- **Creative Studio** — a web editor for layered video projects. Layers, timing,
  transitions, text, images, voiceover, music.
- **The connector** — the same projects, exposed to ChatGPT or Claude so the
  model can build and edit them by talking. This is the point of the product:
  the model does the work, the web editor is where you check and adjust it.

## Accounts you need

Four, and one optional. Register them on whatever email you want to own this
with — a paid plan on a personal address is fine.

| Service | Plan | What it does |
|---|---|---|
| **Vercel** | Paid | Hosts the app and runs the video renders. The free plan forbids commercial use and cannot render, so this one has to be paid. |
| **Supabase** | Free | The database *and* the media storage: projects, revisions, assets, render jobs, generated images/audio/video, and the sign-ins that let ChatGPT connect. |
| **OpenRouter** | Prepaid | Pays for everything the AI generates — text, images, speech, music, video. This is the bill that actually moves, and **each user brings their own account**: the key is saved per user in Settings, not deployed with the app. |
| **GitHub** | Free | Holds the code. Vercel deploys from it on every push. |
| An email account | — | Sends password resets. Gmail works with an App Password. |

Cloudflare R2 is optional and not used by default — this deployment stores
media in Supabase Storage instead (see `supabase/add_storage_buckets.sql`).
Set the `R2_*` variables in `.env.example` only if you outgrow Supabase
Storage's free-tier quota and want to move media to R2 later.

## Steps

### 1. Put the code on GitHub

Create an empty private repository, then push this folder into it. Vercel reads
from here on every deployment.

### 2. Set up the database and storage

Create a Supabase project. Then open **SQL Editor → New query** and run the
ten files in `supabase/`, in the order given in `supabase/README.md`. Order
matters — later files reference tables (and, for the last file, the storage
buckets) the earlier ones create. The last file, `add_storage_buckets.sql`,
creates the two public Storage buckets this deployment uses in place of
Cloudflare R2 — no separate storage account is needed.

From **Project Settings → API**, copy three values for the next step: the
project URL, the `anon` key, and the `service_role` key.

> The free database goes to sleep after a week with no activity. Opening the
> dashboard wakes it. If the team uses this weekly it will never happen.

### 3. Deploy

Import the GitHub repository into Vercel. Before the first deploy, add every
variable listed in `.env.example` under **Settings → Environment Variables**.
That file explains what each one is and where to get it.

Two of them need generating rather than copying:

- `API_KEY_ENCRYPTION_KEY` — run
  `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
  and paste the result. It encrypts the OpenRouter key each user saves, so
  losing or changing it means everyone has to paste theirs again.
- `NEXT_PUBLIC_APP_URL` — the address the app will live at, no trailing slash.
  Deploy once to find out what Vercel assigns, then set this and redeploy.

`OPENROUTER_API_KEY` is deliberately **not** one of them. Leave it unset: each
account adds its own key after signing up (step 6), and its own OpenRouter
account is billed. Set it only as a temporary shared fallback — every user
without a key of their own then spends from it.

### 4. Turn on Supabase authentication

In Supabase under **Authentication → URL Configuration**, set the site URL to
the same address as `NEXT_PUBLIC_APP_URL` and add `<that address>/auth/callback`
to the redirect list. Sign-in fails without this.

Then, under **Authentication → Sign In / Providers → Email**, turn **Confirm
email** *off*. Signing up then creates the account and signs the person in on
the spot, with no confirmation link to go and find. Leave it on only if you
want the inbox round trip — `/signup` handles both, showing a "check your
email" screen when the project still asks for confirmation.

### 5. Create the accounts

Visit `/signup` and create one account per person. There is no invite flow and
no admin panel — signing up is the whole process.

### 6. Add your OpenRouter key

Sign in and go to **Settings → API keys**. Paste a key from
<https://openrouter.ai/keys>; it is checked against OpenRouter before it is
saved, then encrypted and stored against your account. Everything you generate
from then on — in the web editor and through the connector — is billed to your
OpenRouter account, not to whoever deployed the app.

Each person who signs up does this once. Until they do, the dashboard prompts
them and generation is unavailable; the rest of the app works.

### 7. Connect an AI

In ChatGPT or Claude, add a connector pointing at:

```
https://<your address>/api/mcp
```

It will ask you to sign in with the account from step 5. Once approved, the
model can list, create, edit and render projects.

## What it costs

Vercel is a flat monthly fee. Supabase is free (Storage included, at its own
free-tier quota). OpenRouter is the only bill that varies, and it varies a
lot — generated video is by far the most expensive thing here, images and
voiceover are minor.

That bill lands on each user's own OpenRouter account, so the deployment's
cost does not grow with the number of people using it. Everyone should still
set a spending limit on their own OpenRouter key.

## Rendering

Renders happen on Vercel and the finished MP4 lands in Supabase Storage,
which means the AI can hand back a finished file rather than a to-do. A
minute of vertical 1080p takes a few minutes of render time.

If the render bill ever becomes the problem, rendering can be moved into the
browser instead — free, but then the AI can only say "ready to export" and a
person has to click the button. That trade is not made here.

## One licence to check

This is built on Remotion, which is free for individuals and companies with
three employees or fewer, and needs a paid company licence above that. That is
based on the size of the company using it, not on who owns the accounts. Worth
confirming before it goes into daily use: <https://remotion.dev/license>

## Renaming it

The product name is a placeholder. `lib/brand.ts` holds the display name and
explains the single command that renames the AI-facing tool names, which are the
most visible branding in the product — they appear in ChatGPT's own tool list.
