/**
 * The CORS rule that lets the browser upload straight into the bucket.
 *
 * Backblaze's web console can only create download rules; a rule that allows
 * `s3_put` has to go through its native API, signed by a key that may change
 * bucket settings - which the app's own key deliberately cannot. So the
 * owner pastes the master key once into Settings, this applies the rule, and
 * the key is dropped: it is never stored, logged or returned.
 */

const RULE_NAME = "studio-uploads";

export interface B2CorsRule {
  corsRuleName: string;
  allowedOrigins: string[];
  allowedOperations: string[];
  allowedHeaders?: string[];
  exposeHeaders?: string[];
  maxAgeSeconds: number;
}

/**
 * The bucket's rules with ours placed first. B2 applies the first rule that
 * matches, and the console's download-only rule for the same origin would
 * otherwise answer an upload's preflight with a refusal. Other rules are kept.
 */
export function withUploadRule(existing: B2CorsRule[], origins: string[]): B2CorsRule[] {
  const ours: B2CorsRule = {
    corsRuleName: RULE_NAME,
    allowedOrigins: [...new Set(origins)],
    allowedOperations: ["s3_put", "s3_get", "s3_head"],
    allowedHeaders: ["*"],
    exposeHeaders: ["ETag"],
    maxAgeSeconds: 3600,
  };
  return [ours, ...existing.filter((rule) => rule.corsRuleName !== RULE_NAME)].slice(0, 100);
}

async function b2Call<T>(url: string, token: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: token, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.message ?? `Backblaze answered ${response.status}`);
  return payload as T;
}

export async function applyUploadCors(input: {
  keyId: string;
  applicationKey: string;
  bucketName: string;
  origins: string[];
}): Promise<{ bucketName: string; origins: string[] }> {
  const authorize = await fetch("https://api.backblazeb2.com/b2api/v3/b2_authorize_account", {
    headers: { Authorization: `Basic ${Buffer.from(`${input.keyId}:${input.applicationKey}`).toString("base64")}` },
  });
  const account = await authorize.json().catch(() => ({}));
  if (!authorize.ok) {
    throw new Error(authorize.status === 401 ? "Backblaze did not accept that key ID and key." : account?.message ?? "Could not sign in to Backblaze");
  }
  const apiUrl: string | undefined = account?.apiInfo?.storageApi?.apiUrl;
  const token: string | undefined = account?.authorizationToken;
  const accountId: string | undefined = account?.accountId;
  if (!apiUrl || !token || !accountId) throw new Error("Backblaze returned an unexpected sign-in response");
  const capabilities: string[] = account?.apiInfo?.storageApi?.capabilities ?? [];
  if (!capabilities.includes("writeBuckets")) {
    throw new Error("This key cannot change bucket settings. Use the Master Application Key.");
  }

  const listed = await b2Call<{ buckets: Array<{ bucketId: string; bucketName: string; corsRules?: B2CorsRule[] }> }>(
    `${apiUrl}/b2api/v3/b2_list_buckets`,
    token,
    { accountId, bucketName: input.bucketName },
  );
  const bucket = listed.buckets.find((item) => item.bucketName === input.bucketName);
  if (!bucket) throw new Error(`No bucket named ${input.bucketName} on this Backblaze account`);

  const corsRules = withUploadRule(bucket.corsRules ?? [], input.origins);
  await b2Call(`${apiUrl}/b2api/v3/b2_update_bucket`, token, { accountId, bucketId: bucket.bucketId, corsRules });
  return { bucketName: bucket.bucketName, origins: corsRules[0].allowedOrigins };
}
