"use client";

import type { ReactNode } from "react";
import { useMobileViewport } from "./use-mobile-viewport";

/** Render one label, with concise mobile copy and explicit desktop context. */
export function ResponsiveLabel({ compact, children }: { compact: string; children: ReactNode }) {
  const mobile = useMobileViewport();
  return <>{mobile ? compact : children}</>;
}
