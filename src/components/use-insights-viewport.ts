"use client";

import { useSyncExternalStore } from "react";

const query = "(max-width: 767px)";
const subscribe = (callback: () => void) => {
  const media = window.matchMedia(query);
  media.addEventListener("change", callback);
  return () => media.removeEventListener("change", callback);
};
/** Same initial snapshot on server/client; match CSS after hydration, without client-clock state. */
export function useInsightsViewport() {
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches, () => true);
}
