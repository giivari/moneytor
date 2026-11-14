import type { ComponentType, ReactNode } from "react";
import type { IconProps } from "@phosphor-icons/react";
import { FinancialAmount } from "./financial-amount";
import { ICON_SM } from "./icon-size";

/** Shared, server-safe page primitives. Styles live in src/app/ui.css. */

export type Tone = "positive" | "negative" | "";
export const toneOf = (value: bigint): Tone => (value < 0n ? "negative" : "");
export const shortDate = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00+07:00`).toLocaleDateString("id-ID", { day: "numeric", month: "short", timeZone: "Asia/Jakarta" });
/** "2027-02" -> "Feb 2027" */
export const monthLabel = (period: string) => new Date(`${period}-01T00:00:00+07:00`).toLocaleDateString("id-ID", { month: "short", year: "numeric", timeZone: "Asia/Jakarta" });

export function Amount({ value, level = "row", tone = "" }: { value: string; level?: "summary" | "entity" | "row" | "supporting"; tone?: Tone }) {
  return <FinancialAmount value={value} level={level} className={`ui-amount${tone ? ` pnl-${tone}` : ""}`} />;
}

export function Card({ title, meta, action, figures, className = "", children, id }: {
  title: string; meta?: ReactNode; action?: ReactNode; /** Summary figures shown inside the header. */ figures?: ReactNode;
  className?: string; children: ReactNode; id?: string;
}) {
  return <section className={`ui-card ${className}`} aria-labelledby={id}>
    <header className="ui-card-header">
      <div className="ui-card-title"><h2 id={id}>{title}</h2>{meta && <span>{meta}</span>}</div>
      {action && <div className="ui-card-action">{action}</div>}
      {figures && <div className="ui-card-figures">{figures}</div>}
    </header>
    {children}
  </section>;
}

export function Kpi({ title, icon: Icon, tone, value, valueTone = "", note, action }: {
  title: string; icon: ComponentType<IconProps>; tone: "neutral" | "info" | "negative" | "warning" | "positive";
  value: string; valueTone?: Tone; note: ReactNode; action?: ReactNode;
}) {
  return <section className="ui-kpi" data-tone={tone}>
    <header><h2>{title}</h2><span className="ui-kpi-icon" aria-hidden="true"><Icon size={ICON_SM} weight="bold" /></span></header>
    <Amount value={value} level="summary" tone={valueTone} />
    <div className="ui-kpi-note">{note}</div>
    {action && <div className="ui-kpi-action">{action}</div>}
  </section>;
}

export type BreakdownRow = { label: string; value: string; sign?: "minus"; hint?: string };

export function Breakdown({ title, rows, total }: { title: string; rows: BreakdownRow[]; total: { label: string; value: string; tone: Tone } }) {
  return <Card className="ui-breakdown-card" title={title} figures={<Amount value={total.value} level="entity" tone={total.tone} />}>
    <dl className="ui-breakdown">
      {rows.map((row) => <div key={row.label} data-sign={row.sign}>
        <dt>{row.sign === "minus" ? "Dikurangi: " : ""}{row.label}{row.hint && <small>{row.hint}</small>}</dt>
        <dd><Amount value={row.value} tone={row.sign === "minus" ? "negative" : ""} /></dd>
      </div>)}
      <div className="ui-breakdown-total"><dt>{total.label}</dt><dd><Amount value={total.value} level="entity" tone={total.tone} /></dd></div>
    </dl>
  </Card>;
}

export function Chip({ tone, children }: { tone?: "negative" | "warning" | "positive" | "info" | "neutral"; children: ReactNode }) {
  return <span className="ui-chip" data-tone={tone}>{children}</span>;
}

/** Page title row; pass to PageTabs `heading` or wrap in <header className="page-header"> when the page has no tabs. */
export function PageHeading({
  title,
  description,
  summary,
  actions,
}: {
  title: string;
  description?: ReactNode;
  summary?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="page-heading-row">
      <div className="page-heading-main">
        <div className="page-heading-title-group">
          <h1>{title}</h1>
          {summary && <div className="page-heading-summary">{summary}</div>}
        </div>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="page-heading-actions">{actions}</div>}
    </div>
  );
}
