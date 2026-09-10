import { redirect } from "next/navigation";

/**
 * There is no public marketing site on this deployment — the product is the
 * dashboard. The root path exists only to send people to it; the dashboard
 * layout handles sending signed-out visitors to /login.
 */
export default function RootPage() {
  redirect("/dashboard");
}
