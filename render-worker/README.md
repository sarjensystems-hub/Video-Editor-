# Render worker

Renders MP4 exports and preview frames on a machine you control, instead of
a Vercel Sandbox. It is a small Node service with headless Chrome that runs
the same Remotion composition (`remotion/index.ts`), so the output is the
same frame for frame.

The app talks to it over HTTPS (`lib/creative/render-worker.ts`). The worker
holds no storage or database credentials: for each job it gets signed URLs to
download media from and to upload the result to. When a render finishes it
calls the job's signed callback URL.

## Turning it on

1. In Vercel → Project → Settings → Environment Variables, set
   `CREATIVE_RENDER_WORKER_SECRET` (Production) to a random string
   (`openssl rand -hex 32`), and redeploy once. That secret alone switches
   rendering to the worker.
2. On the rendering machine, create `.env.worker.local` in the repository
   root (git ignores it):

   ```
   RENDER_WORKER_SECRET=<the same secret>
   RENDER_WORKER_APP_URL=https://<your app's domain>
   RENDER_WORKER_TUNNEL=cloudflare
   ```

3. Run `npm run render-worker`.

The worker starts a free Cloudflare quick tunnel itself (`cloudflared` must
be installed; no Cloudflare account is needed). It then tells the app its
address through `/api/render-worker/register`. The app only saves the address
after it has reached the worker there with the secret. When the tunnel
restarts, or stops answering, the worker gets a new address and registers it
again, so nothing in Vercel ever needs changing or redeploying.

On a machine with a fixed public address (a VPS behind Caddy, a named
tunnel), set `RENDER_WORKER_PUBLIC_URL` instead of `RENDER_WORKER_TUNNEL`.
`CREATIVE_RENDER_WORKER_URL` in Vercel is optional. It is only used until a
worker registers for the first time.

Delete `CREATIVE_RENDER_WORKER_SECRET` and redeploy to go back to the Vercel
Sandbox. A render already running in a sandbox still finishes there.

## Running it

### Docker (VPS, Fly.io, Railway, Render…)

From the repository root:

```bash
docker build -f render-worker/Dockerfile -t studio-render-worker .
```

```bash
docker run -d --restart unless-stopped -p 8787:8787 -e RENDER_WORKER_SECRET=change-me studio-render-worker
```

Put HTTPS in front of it, for example with Caddy (`caddy reverse-proxy --from render.example.com --to localhost:8787`)
or the platform's own TLS. A 4–8 vCPU machine renders faster than the
4-vCPU sandbox did. Frames render in parallel, so cores matter most.

### Your own computer

Needs Node 22, `cloudflared`, and the repository checked out:

```bash
npm ci
```

```bash
RENDER_WORKER_SECRET=change-me npm run render-worker
```

The first start downloads Chrome Headless Shell and bundles the composition
(about half a minute). Then it starts the tunnel and registers it. Look for
`registered https://….trycloudflare.com` in its output. Renders only run while
the computer is awake and the worker is running.

## Settings

Set these in the environment or in `.env.worker.local` in the repository root.

| Variable | Default | |
| --- | --- | --- |
| `RENDER_WORKER_SECRET` | required | Shared with the app's `CREATIVE_RENDER_WORKER_SECRET`; 16+ characters |
| `RENDER_WORKER_APP_URL` | none | The app's address; the worker registers its public address there |
| `RENDER_WORKER_TUNNEL` | none | `cloudflare` runs a free quick tunnel and keeps it registered |
| `RENDER_WORKER_PUBLIC_URL` | none | A fixed public https address to register instead |
| `CLOUDFLARED_PATH` | `cloudflared` | The cloudflared executable |
| `PORT` | `8787` | |
| `RENDER_WORKER_MAX_RENDERS` | `1` | MP4 renders at once; the rest wait in a queue |
| `RENDER_WORKER_CONCURRENCY` | CPUs − 1 | Browser tabs drawing frames per render |
| `RENDER_WORKER_BUNDLE_DIR` | bundles at start | A prebuilt `remotion bundle` output |
| `RENDER_WORKER_TMP` | OS temp dir | Where MP4s are written before upload |
| `RENDER_WORKER_GL` | Remotion's default | Chrome OpenGL backend (`angle`, `egl`, `swangle`, …) |
| `RENDER_WORKER_BROWSER_EXECUTABLE` | downloads Chrome Headless Shell | Use an installed Chrome/Chromium instead |
| `FFMPEG_PATH` | Remotion's bundled ffmpeg | Used to make small preview copies of large videos |

## What to know

- Render state lives in memory. If the worker restarts, its running renders
  fail. A render whose MP4 was already uploaded still counts as completed.
- While the worker is unreachable, a render already running keeps showing as
  rendering, and is given up on after six hours. A new render started while
  it is unreachable fails at once with "The render worker is unreachable".
- Each job's media is downloaded once into the job's own folder and deleted
  afterwards, so storage is read once per job, never once per frame.
- The worker needs outbound HTTPS to the storage host (`*.storage.dev`), to
  the app (for callbacks), and to Google Fonts if documents use them.
