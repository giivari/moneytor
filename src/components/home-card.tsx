import type { ReactNode } from "react";

/** Card with a compact header row (title, meta, action) used across Beranda. */
export function HomeCard({ title, meta, action, figures, className = "", children, id }: {
  title: string; meta?: ReactNode; action?: ReactNode; /** Summary figures shown inside the header. */ figures?: ReactNode;
  className?: string; children: ReactNode; id?: string;
}) {
  return <section className={`home-card ${className}`} aria-labelledby={id}>
    <header className="home-card-header">
      <div className="home-card-title"><h2 id={id}>{title}</h2>{meta && <span>{meta}</span>}</div>
      {action && <div className="home-card-action">{action}</div>}
      {figures && <div className="home-card-figures">{figures}</div>}
    </header>
    {children}
  </section>;
}
