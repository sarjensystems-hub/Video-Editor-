import { NextResponse } from "next/server";
import sharp from "sharp";
import { createClient } from "@/lib/supabase/server";
import { getActiveSiteId } from "@/lib/active-site";
import { fetchAIResponseWithImages } from "@/lib/openrouter";
import { uploadAnyBytes } from "@/lib/storage";
import { parseDecompositionPlan, pixelCropFromNormalized } from "@/lib/creative/decompose";
import { isTrustedMediaUrl } from "@/lib/creative/media-url";
import { getRuntimeCreativeProject, registerRuntimeCreativeAsset } from "@/lib/creative/project-runtime";
import { InsufficientCreditsError, withCredits } from "@/lib/creative/metering";
import { CREDIT_COSTS } from "@/lib/credit-costs";

export const runtime = "nodejs";
export const maxDuration = 180;

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const projectId = typeof body?.project_id === "string" ? body.project_id.trim() : "";
  const assetId = typeof body?.asset_id === "string" ? body.asset_id.trim() : "";
  if (!projectId || !assetId) return NextResponse.json({ error: "project_id and asset_id are required" }, { status: 400 });
  const context = { supabase, userId: user.id, siteId: await getActiveSiteId() };
  if (!await getRuntimeCreativeProject(context, projectId)) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const { data: source, error } = await supabase
    .from("creative_assets")
    .select("id, project_id, kind, source, url, mime_type, filename, storage_path")
    .eq("id", assetId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (error || !source) return NextResponse.json({ error: "Source asset not found" }, { status: 404 });
  if (source.project_id && String(source.project_id) !== projectId) return NextResponse.json({ error: "Source asset belongs to another project" }, { status: 400 });
  if (source.kind !== "image" || (source.mime_type && !String(source.mime_type).startsWith("image/"))) return NextResponse.json({ error: "Only image assets can be decomposed" }, { status: 400 });
  if (!isTrustedMediaUrl(String(source.url))) return NextResponse.json({ error: "Decomposition requires an image stored in Studio-managed media storage" }, { status: 400 });

  const prompt = `Analyze this flat design image for editable reconstruction. Return JSON only with {"candidates":[...]}. Each candidate must have role, label, confidence, x, y, width, height. Coordinates are normalized 0..1 relative to the full image. Allowed roles only: subject, product, logo, text, foreground, other. Identify visually separable semantic regions worth exposing as reviewable crop layers. Prefer a small useful set over tiny fragments. Do not claim transparency or perfect segmentation.`;
  try {
    // A vision call plus an upload per region. Charged around the whole thing
    // so a failure mid-way refunds rather than billing for nothing.
    const rawPlan = await withCredits(
      { supabase, user },
      "creative_decompose",
      CREDIT_COSTS.creative_decompose,
      () => fetchAIResponseWithImages(prompt, [String(source.url)], 2500, true),
    );
    const candidates = parseDecompositionPlan(rawPlan);
    if (candidates.length === 0) return NextResponse.json({ candidates: [], warning: "No sufficiently confident editable regions were identified." });

    const sourceResponse = await fetch(String(source.url));
    if (!sourceResponse.ok) throw new Error(`Could not download source image (${sourceResponse.status})`);
    const sourceBytes = Buffer.from(await sourceResponse.arrayBuffer());
    const normalized = await sharp(sourceBytes).rotate().png().toBuffer({ resolveWithObject: true });
    const imageWidth = normalized.info.width;
    const imageHeight = normalized.info.height;
    const outputs = [];

    for (let index = 0; index < candidates.length; index += 1) {
      const candidate = candidates[index];
      const crop = pixelCropFromNormalized(candidate.box, imageWidth, imageHeight);
      const bytes = await sharp(normalized.data).extract(crop).png().toBuffer();
      const storagePath = `creative-assets/${user.id}/decomposition/${crypto.randomUUID()}-${candidate.role}.png`;
      const url = await uploadAnyBytes(bytes, storagePath, "image/png");
      if (!url) throw new Error(`Could not persist decomposed candidate ${candidate.label}`);
      const asset = await registerRuntimeCreativeAsset(context, {
        projectId,
        kind: "image",
        source: "decomposition",
        url,
        mimeType: "image/png",
        filename: `${candidate.role}-${index + 1}.png`,
        width: crop.width,
        height: crop.height,
        sizeBytes: bytes.byteLength,
        storagePath,
        metadata: {
          source_asset_id: assetId,
          role: candidate.role,
          label: candidate.label,
          confidence: candidate.confidence,
          normalized_box: candidate.box,
          pixel_crop: crop,
          decomposition_kind: "semantic-crop",
          alpha_matte: false,
        },
      });
      outputs.push({
        asset,
        role: candidate.role,
        label: candidate.label,
        confidence: candidate.confidence,
        box: candidate.box,
        suggested_transform: {
          x: Math.round(candidate.box.x * 1080),
          y: Math.round(candidate.box.y * 1080),
          width: Math.round(candidate.box.width * 1080),
          height: Math.round(candidate.box.height * 1080),
        },
      });
    }

    return NextResponse.json({
      candidates: outputs,
      source: { asset_id: assetId, width: imageWidth, height: imageHeight },
      limitation: "These are reviewable semantic crops from the original pixels, not guaranteed alpha-matted object cutouts.",
    });
  } catch (decomposeError) {
    // 402 rather than 500: nothing failed, there was just nothing to spend.
    if (decomposeError instanceof InsufficientCreditsError) {
      return NextResponse.json(
        { error: decomposeError.message, required: decomposeError.required, balance: decomposeError.balance },
        { status: 402 },
      );
    }
    return NextResponse.json({ error: decomposeError instanceof Error ? decomposeError.message : String(decomposeError) }, { status: 500 });
  }
}