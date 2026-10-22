import type { resolveProviderMark } from "@/lib/domain/provider-marks";

type ResolvedBrandMark = Pick<
  ReturnType<typeof resolveProviderMark>,
  "monogram" | "tone" | "matchedKey"
>;

const BRAND_ASSET_MAP: Record<string, string> = {
  mastercard: "/brands/mastercard.svg",
  visa: "/brands/visa.svg",
  jcb: "/brands/jcb.svg",
  gpn: "/brands/gpn.svg",
  qris: "/brands/qris.svg",
  bca: "/brands/bca.svg",
  mandiri: "/brands/mandiri.svg",
  bni: "/brands/bni.svg",
  bri: "/brands/bri.svg",
  bsi: "/brands/bsi.svg",
  jago: "/brands/jago.svg",
  seabank: "/brands/seabank.svg",
  blu: "/brands/blu.svg",
  gopay: "/brands/gopay.svg",
  ovo: "/brands/ovo.svg",
  dana: "/brands/dana.svg",
  shopeepay: "/brands/shopeepay.svg",
  linkaja: "/brands/linkaja.svg",
  emoney: "/brands/emoney.svg",
  "mandiri-emoney": "/brands/mandiri-emoney.svg",
  flazz: "/brands/flazz.svg",
  tapcash: "/brands/tapcash.svg",
  brizzi: "/brands/brizzi.svg",
  bibit: "/brands/bibit.svg",
  bareksa: "/brands/bareksa.svg",
  ajaib: "/brands/ajaib.svg",
  stockbit: "/brands/stockbit.svg",
  pluang: "/brands/pluang.svg",
  pintu: "/brands/pintu.svg",
  cash: "/brands/cash.svg",
};

export function ProviderBrandMark({
  mark,
  size = "md",
}: {
  mark: ResolvedBrandMark;
  size?: "sm" | "md";
}) {
  const src = mark.matchedKey ? BRAND_ASSET_MAP[mark.matchedKey] : undefined;
  const sizeClass = size === "sm" ? " finance-asset-mark--sm" : "";

  if (src) {
    return (
      <span
        className={`finance-asset-mark finance-asset-mark--brand${sizeClass}`}
        aria-hidden="true"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt=""
          className="brand-mark-img"
          loading="lazy"
          decoding="async"
        />
      </span>
    );
  }

  return (
    <span className={`finance-asset-mark${sizeClass}`} data-tone={mark.tone} aria-hidden="true">
      {mark.monogram}
    </span>
  );
}
