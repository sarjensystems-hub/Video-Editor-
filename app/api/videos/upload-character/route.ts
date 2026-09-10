/**
 * POST /api/videos/upload-character
 *
 * Accepts a multipart form with a "file" field (a character reference
 * image). Uploads the raw bytes as-is — no resizing, no re-encoding, no
 * quality reduction — and returns { url }. Used by the Videos workspace to
 * collect up to MAX_VIDEO_CHARACTERS reference images before submitting a
 * generation job.
 */
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { uploadAnyBytes } from "@/lib/storage";

export const maxDuration = 30;

const MAX_BYTES = 25 * 1024 * 1024; // 25 MB — raw uploads, no compression
const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  const file = formData.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 });

  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "File too large (max 25 MB)" }, { status: 400 });
  }
  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json({ error: "Unsupported file type" }, { status: 400 });
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const ext   = file.type.split("/")[1];
  const path  = `${user.id}/character-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`;

  const url = await uploadAnyBytes(bytes, path, file.type);
  if (!url) return NextResponse.json({ error: "Upload failed (see server logs)" }, { status: 500 });
  return NextResponse.json({ url });
}
