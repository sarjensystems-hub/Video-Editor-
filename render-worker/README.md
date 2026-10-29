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

1. Run the worker somewhere the internet can reach over HTTPS (see below).
2. In Vercel → Project → Settings → Environment Variables, set:
   - `CREATIVE_RENDER_WORKER_URL`: the worker's public URL, e.g. `https://render.example.com`
   - `CREATIVE_RENDER_WORKER_SECRET`: the same value as the worker's `RENDER_WORKER_SECRET`
3. Redeploy. New renders and previews go to the worker. A render that was
   already running in a sandbox still finishes there. With the worker
   configured, the build also skips creating a Vercel Sandbox snapshot.

Unset either variable to go back to the Vercel Sandbox.

Make a secret with `openssl rand -hex 32`.

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

Needs Node 22 and the repository checked out:

```bash
npm ci
```

```bash
RENDER_WORKER_SECRET=change-me npm run render-worker
```

The first start downloads Chrome Headless Shell and bundles the composition
(about half a minute). To reach it from Vercel without opening a port, use a
tunnel. A free Cloudflare quick tunnel works:

```bash
cloudflared tunnel --url http://localhost:8787
```

Set `CREATIVE_RENDER_WORKER_URL` to the `https://….trycloudflare.com` address
it prints. Quick-tunnel addresses change on every restart; a named Cloudflare
tunnel keeps one address. Renders only run while the computer is awake.

## Settings

| Variable | Default | |
| --- | --- | --- |
| `RENDER_WORKER_SECRET` | required | Bearer token the app must send; 16+ characters |
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
- While the worker is unreachable, its renders keep showing as rendering. They
  are given up on after six hours.
- Each job's media is downloaded once into the job's own folder and deleted
  afterwards, so storage is read once per job, never once per frame.
- The worker needs outbound HTTPS to the storage host (`*.storage.dev`), to
  the app (for callbacks), and to Google Fonts if documents use them.
