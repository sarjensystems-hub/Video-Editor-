import Link from "next/link";
import { redirect } from "next/navigation";
import BrandLogo from "@/components/BrandLogo";
import { createClient } from "@/lib/supabase/server";
import { findClient } from "@/lib/oauth/store";
import { redirectUriIsRegistered } from "@/lib/oauth/protocol";
import OAuthConsentClient from "./OAuthConsentClient";

export const dynamic = "force-dynamic";

type Params = {
  client_id?: string;
  redirect_uri?: string;
  code_challenge?: string;
  code_challenge_method?: string;
  scope?: string;
  state?: string;
};

export default async function OAuthConsentPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    const query = new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][]);
    redirect(`/login?redirect=${encodeURIComponent(`/oauth/consent?${query}`)}`);
  }

  // The screen re-verifies the request rather than rendering whatever it is
  // handed: a consent prompt naming a client that was never registered, or
  // pointing at an unregistered URI, is a phishing surface.
  const clientId = params.client_id ?? "";
  const redirectUri = params.redirect_uri ?? "";
  const client = clientId ? await findClient(clientId) : null;
  const valid =
    client && redirectUri && params.code_challenge && redirectUriIsRegistered(redirectUri, client.redirectUris);

  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-canvas-subtle px-4 py-12">
      <div className="w-full max-w-lg rounded-2xl border border-edge bg-panel p-6 sm:p-8">
        <Link href="/" className="mb-7 inline-block">
          <BrandLogo className="h-8" />
        </Link>

        {valid ? (
          <OAuthConsentClient
            clientName={client.clientName}
            email={user!.email ?? ""}
            params={{
              client_id: clientId,
              redirect_uri: redirectUri,
              code_challenge: params.code_challenge!,
              code_challenge_method: params.code_challenge_method ?? "S256",
              scope: params.scope ?? "mcp",
              state: params.state ?? "",
            }}
          />
        ) : (
          <div className="rounded-xl bg-danger-wash px-4 py-3 text-sm text-danger">
            This authorization request is missing or invalid. Start the connection again from the app
            you are trying to connect.
          </div>
        )}
      </div>
    </main>
  );
}
