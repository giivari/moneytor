import type { ReactNode } from "react";
import { ResponsiveDisclosure } from "./responsive-disclosure";

/** Simple visibility settings stay inline; multi-setting option groups may disclose. */
export function ListToolbar({ children, label, visibility, options, activeOptions }: { children: ReactNode; label: string; visibility?: ReactNode; options?: ReactNode; activeOptions?: string }) {
  return <div className="list-toolbar" role="group" aria-label={label}>{children}
    {visibility}
    {options && <ResponsiveDisclosure label="Opsi tampilan" summary={activeOptions} desktopExpanded className="list-toolbar-options">{options}</ResponsiveDisclosure>}
  </div>;
}
