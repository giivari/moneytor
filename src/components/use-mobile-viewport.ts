"use client";

import { useSyncExternalStore } from "react";

const mobileQuery = "(max-width: 600px)";
function subscribe(callback: () => void) {
  const query = window.matchMedia(mobileQuery);
  query.addEventListener("change", callback);
  return () => query.removeEventListener("change", callback);
}

export function useMobileViewport() {
  return useSyncExternalStore(subscribe, () => window.matchMedia(mobileQuery).matches, () => true);
}
