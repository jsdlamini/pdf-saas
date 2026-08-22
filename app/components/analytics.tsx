"use client";

import { useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useAuth } from "@clerk/nextjs";

const ANALYTICS_ENDPOINT = "/api/analytics";

function track(event: string, data?: Record<string, string>) {
  try {
    navigator.sendBeacon(
      ANALYTICS_ENDPOINT,
      JSON.stringify({ event, ...data })
    );
  } catch {
    fetch(ANALYTICS_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event, ...data }),
      keepalive: true,
    }).catch(() => { /* deliberately silent: best-effort */ });
  }
}

export function useAnalytics() {
  const { userId, isLoaded } = useAuth();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tracked = useRef<string | null>(null);

  useEffect(() => {
    // Wait for auth to resolve so pageviews are attributed to the signed-in
    // user (or "guest") rather than always landing with a null user_id.
    if (!isLoaded) return;

    const full = pathname + (searchParams.toString() ? `?${searchParams}` : "");
    if (tracked.current === full) return;
    
    // Skip dashboard and API routes from analytics
    if (pathname.startsWith("/dashboard") || pathname.startsWith("/api")) return;
    
    tracked.current = full;

    track("pageview", {
      path: pathname,
      referrer: document.referrer || "direct",
      tool: pathname.startsWith("/tools/")
        ? pathname.split("/")[2]
        : pathname.startsWith("/research-studio")
        ? "research-studio"
        : "home",
      userId: userId || "guest",
    });
  }, [pathname, searchParams, isLoaded, userId]);
}

export function trackEvent(event: string, data?: Record<string, string>) {
  track(event, data);
}
