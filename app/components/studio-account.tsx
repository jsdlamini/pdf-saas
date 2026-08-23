"use client";

import { SignInButton, SignUpButton, UserButton, useAuth } from "@clerk/nextjs";

// Studio header auth control. Signed out → a clear Sign up / Sign in pair.
// Signed in → Clerk's UserButton avatar menu (profile, manage account, sign out).
export default function StudioAccount() {
  const { isLoaded, userId } = useAuth();
  const isSignedIn = Boolean(isLoaded && userId);

  if (isSignedIn) {
    return <UserButton />;
  }

  if (!isLoaded) {
    return <span className="studio-btn studio-btn-ghost" style={{ width: 32, padding: 0 }} aria-hidden="true" />;
  }

  return (
    <div className="flex items-center gap-2">
      <SignUpButton mode="modal">
        <button type="button" className="studio-btn studio-btn-primary">
          Sign up
        </button>
      </SignUpButton>
      <SignInButton mode="modal">
        <button type="button" className="studio-btn studio-btn-secondary">
          Sign in
        </button>
      </SignInButton>
    </div>
  );
}
