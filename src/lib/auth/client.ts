"use client";

import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient();

export async function signOutAndClearTenant() {
  const response = await fetch("/api/auth/logout", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    // Fallback: still attempt Better Auth client sign-out if the wrapper fails.
    await authClient.signOut();
  }

  window.location.assign("/sign-in");
}
