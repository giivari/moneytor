"use client";

import { useState } from "react";

/** Reveal only already-loaded items; attention items belong outside this limit. */
export function useProgressiveList(total: number, initialVisible: number, increment: number) {
  const [additionalVisible, setAdditionalVisible] = useState(0);
  const visibleCount = Math.min(total, initialVisible + additionalVisible);
  const hiddenCount = Math.max(0, total - visibleCount);

  return {
    initialCount: initialVisible,
    visibleCount,
    hiddenCount,
    nextBatchCount: Math.min(increment, hiddenCount),
    canShowMore: hiddenCount > 0,
    canCollapse: visibleCount > initialVisible,
    showMore: () => setAdditionalVisible((previous) => Math.min(Math.max(0, total - initialVisible), previous + increment)),
    collapse: () => setAdditionalVisible(0),
  };
}
