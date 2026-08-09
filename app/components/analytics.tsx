"use client";

import { useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";

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
    }).catch(() => {});
  }
}

export function useAnalytics() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tracked = useRef<string | null>(null);

  useEffect(() => {
    const full = pathname + (searchParams.toString() ? `?${searchParams}` : "");
    if (tracked.current === full) return;
    tracked.current = full;

    track("pageview", {
      path: pathname,
      referrer: document.referrer || "direct",
      tool: pathname.startsWith("/tools/") ? pathname.split("/")[2] : undefined,
    });
  }, [pathname, searchParams]);
}

export function trackEvent(event: string, data?: Record<string, string>) {
  track(event, data);
}
