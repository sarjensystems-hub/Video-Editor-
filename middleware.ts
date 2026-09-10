/**
 * Next.js Middleware — runs on every request before the page loads.
 *
 * It does two things:
 * 1. Refreshes the user's Supabase session token (keeps them logged in).
 * 2. Redirects unauthenticated users away from protected pages like /dashboard.
 */
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

function safeRelativeRedirect(value: string | null): string | null {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return null;
  return value;
}

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Refresh session — important: do NOT add any logic between this and
  // creating the Supabase client above.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // If the user is not logged in and tries to access /dashboard, redirect to /login
  if (!user && request.nextUrl.pathname.startsWith("/dashboard")) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // If a logged-in user visits /login, honor a safe pending OAuth-consent
  // redirect instead of dropping them at the dashboard.
  if (user && request.nextUrl.pathname === "/login") {
    const pending = safeRelativeRedirect(request.nextUrl.searchParams.get("redirect"));
    if (pending) return NextResponse.redirect(new URL(pending, request.url));
  }

  // If a logged-in user visits /login or /signup, redirect them to /dashboard
  if (
    user &&
    (request.nextUrl.pathname === "/login" ||
      request.nextUrl.pathname === "/signup")
  ) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    /*
     * Run middleware on all routes except:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico
     * - public folder files
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
