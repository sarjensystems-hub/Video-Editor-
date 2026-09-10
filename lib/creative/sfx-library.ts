export const CREATIVE_SFX_LIBRARY = [
  { id: "ui-click", label: "UI click", durationMs: 80 },
  { id: "ui-pop", label: "UI pop", durationMs: 180 },
  { id: "whoosh", label: "Whoosh", durationMs: 400 },
  { id: "success", label: "Success chime", durationMs: 520 },
  { id: "error", label: "Error alert", durationMs: 380 },
  { id: "impact", label: "Soft impact", durationMs: 300 },
] as const;
export type CreativeSfxId = (typeof CREATIVE_SFX_LIBRARY)[number]["id"];

function wav(samples: Int16Array, sampleRate: number): Buffer {
  const bytes = Buffer.alloc(44 + samples.byteLength);
  bytes.write("RIFF", 0); bytes.writeUInt32LE(36 + samples.byteLength, 4); bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(sampleRate, 24); bytes.writeUInt32LE(sampleRate * 2, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36); bytes.writeUInt32LE(samples.byteLength, 40);
  for (let index = 0; index < samples.length; index += 1) bytes.writeInt16LE(samples[index], 44 + index * 2);
  return bytes;
}

function seedFor(value: string) {
  let seed = 2166136261;
  for (const character of value) seed = Math.imul(seed ^ character.charCodeAt(0), 16777619);
  return seed >>> 0;
}

export function generateDeterministicSfxWav(effectId: CreativeSfxId) {
  const effect = CREATIVE_SFX_LIBRARY.find((entry) => entry.id === effectId);
  if (!effect) throw new Error(`Unknown SFX ${effectId}`);
  const sampleRate = 44_100;
  const samples = new Int16Array(Math.round((effect.durationMs / 1000) * sampleRate));
  let seed = seedFor(effectId);
  const noise = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return (seed / 0xffffffff) * 2 - 1; };
  for (let index = 0; index < samples.length; index += 1) {
    const t = index / sampleRate;
    const progress = index / Math.max(1, samples.length - 1);
    let value = 0;
    if (effectId === "ui-click") value = Math.sin(2 * Math.PI * 1700 * t) * Math.exp(-45 * t);
    if (effectId === "ui-pop") value = Math.sin(2 * Math.PI * (420 + 900 * progress) * t) * Math.sin(Math.PI * progress);
    if (effectId === "whoosh") value = noise() * Math.sin(Math.PI * progress) * (0.35 + 0.65 * progress);
    if (effectId === "success") value = Math.sin(2 * Math.PI * (progress < 0.48 ? 660 : 990) * t) * Math.exp(-3.5 * t);
    if (effectId === "error") value = Math.sin(2 * Math.PI * (progress < 0.5 ? 330 : 220) * t) * (1 - progress);
    if (effectId === "impact") value = (0.65 * noise() + 0.35 * Math.sin(2 * Math.PI * 80 * t)) * Math.exp(-12 * t);
    samples[index] = Math.max(-32767, Math.min(32767, Math.round(value * 18_000)));
  }
  return { bytes: wav(samples, sampleRate), contentType: "audio/wav", durationMs: effect.durationMs, effect };
}
