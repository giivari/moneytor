import { Fragment } from "react";

/** Keep currency/sign with the leading digits; narrow layouts may wrap between
 * complete thousands groups. A read-only amount is never a scroll control. */
export function FinancialAmount({ value, level = "supporting", className = "", as = "strong" }: {
  value: string; level?: "hero" | "summary" | "entity" | "row" | "supporting";
  className?: string; as?: "strong" | "span";
}) {
  const Element = as;
  const wide = value.length > 18;
  return <Element className={`financial-value financial-amount financial-value--${level} ${className}`} data-wide={wide}>
    {value.split(/(?=\.\d{3}(?:\D|$))/).map((group, index) => <Fragment key={index}>{wide && index > 0 && <wbr />}<span className="financial-amount-group">{group}</span></Fragment>)}
  </Element>;
}
