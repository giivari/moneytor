import type { ReactNode } from "react";

export function SectionHeading({ title, helper, eyebrow, icon, action }: {
  title: string;
  helper?: string;
  eyebrow?: string;
  icon?: ReactNode;
  action?: ReactNode;
}) {
  return <div className="section-heading section-header">
    {icon && <span className="section-header-icon">{icon}</span>}
    <div className="section-header-copy">{eyebrow && <span className="eyebrow">{eyebrow}</span>}
      <h2>{title}</h2>{helper && <p>{helper}</p>}
    </div>
    {action && <div className="section-header-action">{action}</div>}
  </div>;
}
