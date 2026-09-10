# Studio

A video production tool for a small marketing team. Two halves, one project:

- **Creative Studio** — a web editor for layered video. Layers, timing,
  transitions, text, images, voiceover, music, rendered to an exact MP4.
- **The connector** — those same projects exposed to ChatGPT or Claude, so the
  model builds and edits them by talking. The model does the work; the editor is
  where you check it.

**Setting this up for the first time? Read [SETUP.md](./SETUP.md).**

## Running it locally

```bash
npm install
cp .env.example .env.local   # then fill it in — see SETUP.md
npm run dev
```

## Before you push

```bash
npm test            # 1185 tests
npx tsc --noEmit    # types
```

`npm run build` runs both first, so a green build means both are green. A push
to `main` deploys straight to production — there is no staging step.

## Layout

| Path | What lives there |
|---|---|
| `app/dashboard/` | The web app: Creative Studio, Videos, Settings |
| `app/api/mcp/` | The endpoint ChatGPT and Claude connect to |
| `app/api/oauth/` | Sign-in for those connections |
| `lib/creative/` | The document model, editing, validation and rendering |
| `lib/mcp-server/` | The connector protocol and the video job runner |
| `lib/brand.ts` | Product name and the AI-facing tool prefix |
| `supabase/` | Database setup, in the order to run it |

## Conventions

`AGENTS.md` holds the rules for changing this code — branding, billing, and the
row-level security that keeps one person's projects out of another's.
