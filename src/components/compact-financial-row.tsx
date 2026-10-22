import type { ReactNode } from "react";

/** Compact records stack by default; execution rows can compose horizontally on desktop. */
export function CompactFinancialRow({ identity, context, value, footer, controls, secondaryActions, amountControl, amountLabel = "Akan dicatat", details, desktopLayout, presentation, wideValue = false, as = "div" }: {
  identity: ReactNode;
  context: ReactNode;
  value: ReactNode;
  footer?: ReactNode;
  controls?: ReactNode;
  secondaryActions?: ReactNode;
  amountControl?: ReactNode;
  amountLabel?: ReactNode;
  details?: ReactNode;
  desktopLayout?: "inline" | "confirmation";
  presentation?: "record";
  wideValue?: boolean;
  as?: "div" | "span";
}) {
  const Container = as;
  const secondary = secondaryActions && <Container className="compact-financial-row__secondary">{secondaryActions}</Container>;
  if (presentation === "record") return <Container className="compact-financial-row compact-financial-row--record" data-wide-value={wideValue}>
    <strong className="compact-financial-row__identity">{identity}</strong>
    <Container className="compact-financial-row__value">{value}</Container>
    <Container className="compact-financial-row__context">{context}</Container>
    {footer && <Container className="compact-financial-row__footer">{footer}</Container>}
    {details && <Container className="compact-financial-row__details">{details}</Container>}
  </Container>;
  if (desktopLayout === "confirmation") return <Container className="compact-financial-row compact-financial-row--confirmation">
    <Container className="compact-financial-row__summary">
      <strong className="compact-financial-row__identity">{identity}</strong>
      <Container className="compact-financial-row__context">{context}</Container>
      {footer && <Container className="compact-financial-row__status">{footer}</Container>}
    </Container>
    <Container className="inline-field-action inline-field-action--money inline-field-action--compact compact-financial-row__confirmation">
      <Container className="compact-financial-row__amount" data-editable={amountControl != null}>
        {amountControl ?? <><span className="compact-financial-row__amount-label">{amountLabel}</span>
          <span className="compact-financial-row__amount-value">{value}</span></>}
      </Container>
      <Container className="inline-field-action__actions">{controls}{secondaryActions}</Container>
    </Container>
    {details && <Container className="compact-financial-row__details">{details}</Container>}
  </Container>;
  return <><Container className={`compact-financial-row${desktopLayout === "inline" ? " compact-financial-row--inline" : ""}`}>
    <strong className="compact-financial-row__identity">{identity}</strong>
    <Container className="compact-financial-row__context-value">
      <span className="compact-financial-row__context">{context}</span>
      {value != null && <span className="compact-financial-row__value">{value}</span>}
    </Container>
    {(footer || (!controls && secondary)) && <Container className="compact-financial-row__footer">
      {desktopLayout === "inline" ? <Container className="compact-financial-row__status">{footer}</Container> : footer}
      {!controls && secondary}
    </Container>}
    {controls && <Container className="compact-form-block">
      {desktopLayout === "inline" ? <Container className="compact-financial-row__execution">{controls}{secondary}</Container> : <>{controls}{secondary}</>}
    </Container>}
  </Container>{details}</>;
}
