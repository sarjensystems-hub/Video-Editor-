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

Five, and one optional. Register them on whatever email you want to own this
with — a paid plan on a personal address is fine.

| Service | Plan | What it does |
|---|---|---|
| **Vercel** | Paid | Hosts the app and runs the video renders. The free plan forbids commercial use and cannot render, so this one has to be paid. |
| **Supabase** | Free | The database: projects, revisions, assets, render jobs, and the sign-ins that let ChatGPT connect. |
| **Cloudflare R2** | Pay-as-you-go | Stores every generated image, voiceover, music bed and finished MP4. Costs pennies at this scale. |
| **OpenRouter** | Prepaid | Pays for everything the AI generates — text, images, speech, music, video. This is the bill that actually moves. |
| **GitHub** | Free | Holds the code. Vercel deploys from it on every push. |
| An email account | — | Sends password resets. Gmail works with an App Password. |

## Steps

### 1. Put the code on GitHub

Create an empty private repository, then push this folder into it. Vercel reads
from here on every deployment.

### 2. Set up the database

Create a Supabase project. Then open **SQL Editor → New query** and run the
eight files in `supabase/`, in the order given in `supabase/README.md`. Order
matters — later files reference tables the earlier ones create.

From **Project Settings → API**, copy three values for the next step: the
project URL, the `anon` key, and the `service_role` key.

> The free database goes to sleep after a week with no activity. Opening the
> dashboard wakes it. If the team uses this weekly it will never happen.

### 3. Set up storage

In Cloudflare, create an R2 bucket, allow public read access on it, and create
an API token with read and write permission. You need five values: account ID,
access key ID, secret access key, bucket name, and the bucket's public URL.

Public read is required, not optional: the renderer and the connected AI both
fetch assets over ordinary HTTPS.

### 4. Deploy

Import the GitHub repository into Vercel. Before the first deploy, add every
variable listed in `.env.example` under **Settings → Environment Variables**.
That file explains what each one is and where to get it.

Two of them need generating rather than copying:

- `OAUTH_TOKEN_KEY` — run
  `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
  and paste the result.
- `NEXT_PUBLIC_APP_URL` — the address the app will live at, no trailing slash.
  Deploy once to find out what Vercel assigns, then set this and redeploy.

### 5. Turn on Supabase authentication

In Supabase under **Authentication → URL Configuration**, set the site URL to
the same address as `NEXT_PUBLIC_APP_URL` and add `<that address>/auth/callback`
to the redirect list. Sign-in fails without this.

### 6. Create the accounts

Visit `/signup` and create one account per person. There is no invite flow and
no admin panel — signing up is the whole process.

### 7. Connect an AI

In ChatGPT or Claude, add a connector pointing at:

```
https://<your address>/api/mcp
```

It will ask you to sign in with the account from step 6. Once approved, the
model can list, create, edit and render projects.

## What it costs

Vercel is a flat monthly fee. R2 is pennies. Supabase is free. OpenRouter is the
only bill that varies, and it varies a lot — generated video is by far the most
expensive thing here, images and voiceover are minor. Set a spending limit in
OpenRouter before handing the tool to anyone.

## Rendering

Renders happen on Vercel and the finished MP4 lands in R2, which means the AI
can hand back a finished file rather than a to-do. A minute of vertical 1080p
takes a few minutes of render time.

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
