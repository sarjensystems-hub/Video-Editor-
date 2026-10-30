import { redirect } from "next/navigation";

/**
 * Sign-up is closed: this is an internal tool, and accounts are created by
 * the owner in Supabase (Authentication → Users → Add user / Invite user),
 * with "Allow new users to sign up" switched off there. The address stays
 * only so old links land on the sign-in page instead of a 404.
 */
export default function SignupPage() {
  redirect("/login");
}
