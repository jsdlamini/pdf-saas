"use client";

import { useEffect, useState } from "react";

export default function OfflineIndicator() {
  const [offline, setOffline] = useState(false);
  const [show, setShow] = useState(false);

  useEffect(() => {
    setOffline(!navigator.onLine);
    setShow(!navigator.onLine);

    const goOffline = () => { setOffline(true); setShow(true); };
    const goOnline = () => { setOffline(false); setTimeout(() => setShow(false), 3000); };

    window.addEventListener("offline", goOffline);
    window.addEventListener("online", goOnline);
    return () => {
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("online", goOnline);
    };
  }, []);

  if (!show) return null;

  return (
    <div
      className={`fixed bottom-4 left-4 right-4 z-50 mx-auto max-w-md rounded-xl px-4 py-3 text-center text-sm font-semibold shadow-lg transition-all duration-300 md:left-4 md:right-auto ${
        offline
          ? "bg-orange-100 text-orange-800 border border-orange-300"
          : "bg-green-100 text-green-800 border border-green-300"
      }`}
    >
      {offline ? (
        <span>⚡ You are offline. Browser tools still work.</span>
      ) : (
        <span>✓ Back online. Server tools available again.</span>
      )}
    </div>
  );
}
