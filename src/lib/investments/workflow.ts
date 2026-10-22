import { decimal } from "./math";
import type { InvestmentSnapshot } from "./types";

/** Presentation prerequisites only; server validation remains authoritative. */
export function investmentWorkflow(snapshot: InvestmentSnapshot, cashCurrencies: string[]) {
  const portfolios = snapshot.portfolios.filter((item) => item.isActive);
  const instruments = snapshot.instruments.filter((item) => item.isActive);
  const paired = portfolios.filter((item) => instruments.some((instrument) => instrument.currency === item.currency));
  const portfolio = paired.find((item) => cashCurrencies.includes(item.currency)) ?? paired[0] ?? portfolios[0];
  const instrument = instruments.find((item) => item.currency === portfolio?.currency);
  const recorded = snapshot.holdings.some((item) => item.opening !== null || decimal(item.quantity, true) > 0n)
    || snapshot.trades.some((item) => item.status === "posted");
  const unpriced = snapshot.holdings.find((item) => decimal(item.quantity, true) > 0n && item.marketMinor === null
    && instruments.some((instrument) => instrument.id === item.instrumentId));
  const stage = !portfolio ? "portfolio" : !instrument ? "instrument" : !recorded ? "ownership" : unpriced ? "price" : "ready";
  return { stage, portfolio, instrument, unpriced, recorded,
    canTrade: portfolios.some((item) => cashCurrencies.includes(item.currency) && instruments.some((instrument) => instrument.currency === item.currency)) };
}
