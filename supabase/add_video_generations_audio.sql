-- ============================================================
-- Studio — Video Generation: per-job audio toggle
-- Run this in Supabase SQL Editor.
--
-- generate_audio was previously hardcoded false in code (no column). This
-- adds a real per-generation toggle exposed in the Videos UI.
-- ============================================================

ALTER TABLE video_generations
  ADD COLUMN IF NOT EXISTS generate_audio boolean NOT NULL DEFAULT false;
