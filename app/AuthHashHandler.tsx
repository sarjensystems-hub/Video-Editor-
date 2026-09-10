"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function AuthHashHandler() {
  const router = useRouter();
  useEffect(() => {
    const hash = window.location.hash;
    if (hash.includes("type=recovery")) {
      router.replace("/auth/reset-callback" + hash);
    }
  }, [router]);
  return null;
}
