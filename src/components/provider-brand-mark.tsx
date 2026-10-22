import type { resolveProviderMark } from "@/lib/domain/provider-marks";

type ResolvedBrandMark = Pick<
  ReturnType<typeof resolveProviderMark>,
  "monogram" | "tone" | "matchedKey"
>;

const BRAND_ASSET_MAP: Record<string, { src: string; fit?: "contain" | "cover" }> = {
  mastercard: { src: "/brands/mastercard.svg" },
  visa: { src: "/brands/visa.svg" },
  jcb: { src: "/brands/jcb.svg" },
  gpn: { src: "/brands/gpn.svg" },
  qris: { src: "/brands/qris.svg" },
  bca: { src: "/brands/bca.svg" },
  mandiri: { src: "/brands/mandiri.svg" },
  bni: { src: "/brands/bni.svg" },
  bri: { src: "/brands/bri.svg" },
  bsi: { src: "/brands/bsi.svg" },
  jago: { src: "/brands/jago.svg" },
  seabank: { src: "/brands/seabank.svg" },
  blu: { src: "/brands/blu.svg" },
  gopay: { src: "/brands/gopay.svg" },
  ovo: { src: "/brands/ovo.svg" },
  dana: { src: "/brands/dana.svg" },
  shopeepay: { src: "/brands/shopeepay.svg" },
  linkaja: { src: "/brands/linkaja.svg" },
  emoney: { src: "/brands/emoney.svg" },
  bibit: { src: "/brands/bibit.svg" },
  bareksa: { src: "/brands/bareksa.svg" },
  ajaib: { src: "/brands/ajaib.png", fit: "cover" },
  stockbit: { src: "/brands/stockbit.png", fit: "cover" },
  pluang: { src: "/brands/pluang.png", fit: "cover" },
  pintu: { src: "/brands/pintu.png", fit: "cover" },
  cash: { src: "/brands/cash.svg" },
};

export function ProviderBrandMark({
  mark,
  size = "md",
}: {
  mark: ResolvedBrandMark;
  size?: "sm" | "md";
}) {
  const brand = mark.matchedKey ? BRAND_ASSET_MAP[mark.matchedKey] : undefined;
  const sizeClass = size === "sm" ? " finance-asset-mark--sm" : "";

  if (brand) {
    return (
      <span
        className={`finance-asset-mark finance-asset-mark--brand${sizeClass}`}
        data-tone={mark.tone}
        data-fit={brand.fit ?? "contain"}
        aria-hidden="true"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={brand.src}
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
