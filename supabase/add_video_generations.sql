-- ============================================================
-- Studio — Video Generation (Seedance 2.0 Fast via OpenRouter)
-- Run this in Supabase SQL Editor.
-- ============================================================

CREATE TABLE IF NOT EXISTS video_generations (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  site_id           uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  openrouter_job_id text NOT NULL,
  status            text NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending', 'in_progress', 'completed', 'failed', 'cancelled', 'expired')),
  prompt            text NOT NULL,
  -- [{ "name": "Alice", "url": "https://..." }, ...] — upload order == the
  -- order sent to the model as input_references. Raw, uncompressed images.
  characters        jsonb NOT NULL DEFAULT '[]'::jsonb,
  aspect_ratio      text NOT NULL,
  resolution        text NOT NULL,
  duration_seconds  integer NOT NULL,
  video_url         text,
  error             text,
  credits_charged   integer NOT NULL DEFAULT 0,
  cost_usd          numeric,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE video_generations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own video generations"
  ON video_generations FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS video_generations_user_id_idx ON video_generations(user_id);
CREATE INDEX IF NOT EXISTS video_generations_site_id_idx ON video_generations(site_id, created_at DESC);
