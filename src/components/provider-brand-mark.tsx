import type { ResolvedProviderMark } from "@/lib/domain/provider-marks";

function renderBrandSvg(key: string | null): React.ReactNode {
  switch (key) {
    case "mastercard":
      return (
        <svg viewBox="0 0 42 42" className="brand-mark-svg" aria-hidden="true">
          <rect width="42" height="42" rx="12" fill="#181F2C" />
          <circle cx="16.5" cy="21" r="9.5" fill="#EB001B" />
          <circle cx="25.5" cy="21" r="9.5" fill="#F79E1B" />
          <path
            d="M21 13.55a9.48 9.48 0 0 1 3.5 7.45 9.48 9.48 0 0 1-3.5 7.45 9.48 9.48 0 0 1-3.5-7.45c0-3 1.38-5.68 3.5-7.45Z"
            fill="#FF5F00"
          />
        </svg>
      );

    case "visa":
      return (
        <svg viewBox="0 0 42 42" className="brand-mark-svg" aria-hidden="true">
          <rect width="42" height="42" rx="12" fill="#1434CB" />
          <path d="M5 10h32v3H5z" fill="#ffffff" fillOpacity="0.16" />
          <path d="M5 29h32v3H5z" fill="#F7B600" />
          <text
            x="21"
            y="24.5"
            textAnchor="middle"
            fill="#ffffff"
            fontSize="12"
            fontWeight="900"
            fontStyle="italic"
            fontFamily="system-ui, -apple-system, sans-serif"
            letterSpacing="0.4"
          >
            VISA
          </text>
          <path d="M7.5 16.2h4.2l1.2 2.4-4.2-1.2z" fill="#F7B600" />
        </svg>
      );

    case "jcb":
      return (
        <svg viewBox="0 0 42 42" className="brand-mark-svg" aria-hidden="true">
          <rect width="42" height="42" rx="12" fill="#ffffff" />
          <rect x="6" y="9" width="9" height="24" rx="3.5" fill="#0066B2" />
          <rect x="16.5" y="9" width="9" height="24" rx="3.5" fill="#E4002B" />
          <rect x="27" y="9" width="9" height="24" rx="3.5" fill="#00A94F" />
          <text
            x="10.5"
            y="24"
            textAnchor="middle"
            fill="#ffffff"
            fontSize="9.5"
            fontWeight="800"
            fontFamily="system-ui, sans-serif"
          >
            J
          </text>
          <text
            x="21"
            y="24"
            textAnchor="middle"
            fill="#ffffff"
            fontSize="9.5"
            fontWeight="800"
            fontFamily="system-ui, sans-serif"
          >
            C
          </text>
          <text
            x="31.5"
            y="24"
            textAnchor="middle"
            fill="#ffffff"
            fontSize="9.5"
            fontWeight="800"
            fontFamily="system-ui, sans-serif"
          >
            B
          </text>
        </svg>
      );

    case "gpn":
      return (
        <svg viewBox="0 0 42 42" className="brand-mark-svg" aria-hidden="true">
          <rect width="42" height="42" rx="12" fill="#ffffff" />
          <path
            d="M11 15c4-4.5 13-5.5 20-1.5-5-1.2-12-.5-16.5 3.5Z"
            fill="#E11D48"
          />
          <path
            d="M15 17.5c4.5-3 11.5-3 16.5-.5-4.5-.8-10 .2-13.5 3Z"
            fill="#0284C7"
          />
          <text
            x="21"
            y="30.5"
            textAnchor="middle"
            fill="#0F172A"
            fontSize="10.5"
            fontWeight="900"
            fontFamily="system-ui, sans-serif"
            letterSpacing="0.5"
          >
            GPN
          </text>
        </svg>
      );

    case "qris":
      return (
        <svg viewBox="0 0 42 42" className="brand-mark-svg" aria-hidden="true">
          <rect width="42" height="42" rx="12" fill="#111827" />
          <path d="M8 14V9h5M34 14V9h-5M8 28v5h5M34 28v5h-5" stroke="#E11D48" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          <text
            x="21"
            y="24.5"
            textAnchor="middle"
            fill="#ffffff"
            fontSize="10.2"
            fontWeight="900"
            fontFamily="system-ui, sans-serif"
            letterSpacing="0.6"
          >
            QRIS
          </text>
        </svg>
      );

    case "bca":
      return (
        <svg viewBox="0 0 42 42" className="brand-mark-svg" aria-hidden="true">
          <rect width="42" height="42" rx="12" fill="#005DAA" />
          <circle cx="11" cy="14.5" r="2.6" fill="#ffffff" fillOpacity="0.92" />
          <circle cx="15" cy="14.5" r="2.6" fill="#93C5FD" />
          <circle cx="13" cy="11.5" r="2.6" fill="#ffffff" />
          <circle cx="13" cy="17.5" r="2.6" fill="#ffffff" fillOpacity="0.85" />
          <text
            x="22.5"
            y="31"
            textAnchor="middle"
            fill="#ffffff"
            fontSize="12.5"
            fontWeight="900"
            fontStyle="italic"
            fontFamily="system-ui, sans-serif"
            letterSpacing="0.3"
          >
            BCA
          </text>
        </svg>
      );

    case "mandiri":
      return (
        <svg viewBox="0 0 42 42" className="brand-mark-svg" aria-hidden="true">
          <rect width="42" height="42" rx="12" fill="#003D79" />
          <path
            d="M8 17.5c5.5-5 13.5-5.5 20-2 2.8 1.5 5 1 6.5-.5-1.5 3.5-5.5 4.8-9.5 3-5.5-2.5-11.5-2-17-.5Z"
            fill="#FFB700"
          />
          <text
            x="21"
            y="29.5"
            textAnchor="middle"
            fill="#ffffff"
            fontSize="8.6"
            fontWeight="800"
            fontFamily="system-ui, sans-serif"
            letterSpacing="0.1"
          >
            mandiri
          </text>
        </svg>
      );

    case "bni":
      return (
        <svg viewBox="0 0 42 42" className="brand-mark-svg" aria-hidden="true">
          <rect width="42" height="42" rx="12" fill="#006677" />
          <rect x="6.5" y="13" width="7.5" height="15" rx="2" fill="#F15A22" />
          <text
            x="10.2"
            y="23"
            textAnchor="middle"
            fill="#ffffff"
            fontSize="6.8"
            fontWeight="900"
            fontFamily="system-ui, sans-serif"
          >
            46
          </text>
          <text
            x="25.5"
            y="25.5"
            textAnchor="middle"
            fill="#ffffff"
            fontSize="11.5"
            fontWeight="900"
            fontFamily="system-ui, sans-serif"
            letterSpacing="0.3"
          >
            BNI
          </text>
        </svg>
      );

    case "bri":
      return (
        <svg viewBox="0 0 42 42" className="brand-mark-svg" aria-hidden="true">
          <rect width="42" height="42" rx="12" fill="#00529C" />
          <rect x="6.5" y="13" width="9" height="15" rx="2.5" stroke="#ffffff" strokeWidth="1.8" fill="none" />
          <path d="M9.5 16.5h2.5a1.8 1.8 0 0 1 0 3.5H9.5v-3.5Zm0 3.5h2.8a1.9 1.9 0 0 1 0 3.8H9.5V20Z" fill="#F59E0B" />
          <text
            x="26.5"
            y="25"
            textAnchor="middle"
            fill="#ffffff"
            fontSize="11"
            fontWeight="900"
            fontFamily="system-ui, sans-serif"
          >
            BRI
          </text>
        </svg>
      );

    case "bsi":
      return (
        <svg viewBox="0 0 42 42" className="brand-mark-svg" aria-hidden="true">
          <rect width="42" height="42" rx="12" fill="#00A39D" />
          <polygon points="33,9 34.4,12.2 37.8,12.5 35.2,14.8 36,18 33,16.2 30,18 30.8,14.8 28.2,12.5 31.6,12.2" fill="#FBBF24" />
          <text
            x="19.5"
            y="27"
            textAnchor="middle"
            fill="#ffffff"
            fontSize="12.5"
            fontWeight="900"
            fontFamily="system-ui, sans-serif"
            letterSpacing="0.4"
          >
            BSI
          </text>
        </svg>
      );

    case "jago":
      return (
        <svg viewBox="0 0 42 42" className="brand-mark-svg" aria-hidden="true">
          <rect width="42" height="42" rx="12" fill="#5B21B6" />
          <path d="M14 12h6v10a6 6 0 0 1-10.5 4l3.2-3.2A2.2 2.2 0 0 0 16 21v-9Z" fill="#FBBF24" />
          <circle cx="27" cy="14" r="3" fill="#F43F5E" />
          <text
            x="21"
            y="34.5"
            textAnchor="middle"
            fill="#ffffff"
            fontSize="8.5"
            fontWeight="800"
            fontFamily="system-ui, sans-serif"
          >
            Jago
          </text>
        </svg>
      );

    case "seabank":
      return (
        <svg viewBox="0 0 42 42" className="brand-mark-svg" aria-hidden="true">
          <rect width="42" height="42" rx="12" fill="#FF5722" />
          <path d="M9 17c3.5-3.5 8.5-3.5 12 0s8.5 3.5 12 0" stroke="#ffffff" strokeWidth="2.6" strokeLinecap="round" fill="none" />
          <text
            x="21"
            y="30"
            textAnchor="middle"
            fill="#ffffff"
            fontSize="10.5"
            fontWeight="900"
            fontFamily="system-ui, sans-serif"
          >
            Sea
          </text>
        </svg>
      );

    case "blu":
      return (
        <svg viewBox="0 0 42 42" className="brand-mark-svg" aria-hidden="true">
          <rect width="42" height="42" rx="12" fill="#00A8E8" />
          <circle cx="33.5" cy="14" r="2.6" fill="#FDE047" />
          <text
            x="20"
            y="26.5"
            textAnchor="middle"
            fill="#ffffff"
            fontSize="13.5"
            fontWeight="900"
            fontFamily="system-ui, sans-serif"
          >
            blu
          </text>
        </svg>
      );

    case "gopay":
      return (
        <svg viewBox="0 0 42 42" className="brand-mark-svg" aria-hidden="true">
          <rect width="42" height="42" rx="12" fill="#00AED6" />
          <rect x="11" y="10" width="20" height="13" rx="4" fill="#ffffff" />
          <circle cx="25" cy="16.5" r="2.3" fill="#00AED6" />
          <text
            x="21"
            y="34"
            textAnchor="middle"
            fill="#ffffff"
            fontSize="8.8"
            fontWeight="800"
            fontFamily="system-ui, sans-serif"
          >
            gopay
          </text>
        </svg>
      );

    case "ovo":
      return (
        <svg viewBox="0 0 42 42" className="brand-mark-svg" aria-hidden="true">
          <rect width="42" height="42" rx="12" fill="#4C3494" />
          <text
            x="21"
            y="25.5"
            textAnchor="middle"
            fill="#ffffff"
            fontSize="12.5"
            fontWeight="900"
            fontFamily="system-ui, sans-serif"
            letterSpacing="0.8"
          >
            OVO
          </text>
        </svg>
      );

    case "dana":
      return (
        <svg viewBox="0 0 42 42" className="brand-mark-svg" aria-hidden="true">
          <rect width="42" height="42" rx="12" fill="#108EE9" />
          <path d="M10 14.5c4-2 8 2 12 0s8 2 10 0" stroke="#ffffff" strokeWidth="2.2" strokeLinecap="round" fill="none" />
          <text
            x="21"
            y="28.5"
            textAnchor="middle"
            fill="#ffffff"
            fontSize="10.2"
            fontWeight="900"
            fontFamily="system-ui, sans-serif"
            letterSpacing="0.5"
          >
            DANA
          </text>
        </svg>
      );

    case "shopeepay":
      return (
        <svg viewBox="0 0 42 42" className="brand-mark-svg" aria-hidden="true">
          <rect width="42" height="42" rx="12" fill="#EE4D2D" />
          <path d="M16 14a5 5 0 0 1 10 0" stroke="#ffffff" strokeWidth="2" fill="none" />
          <rect x="11" y="14" width="20" height="19" rx="3.5" fill="#ffffff" />
          <text
            x="21"
            y="27.5"
            textAnchor="middle"
            fill="#EE4D2D"
            fontSize="11.5"
            fontWeight="900"
            fontFamily="system-ui, sans-serif"
          >
            S
          </text>
        </svg>
      );

    case "linkaja":
      return (
        <svg viewBox="0 0 42 42" className="brand-mark-svg" aria-hidden="true">
          <rect width="42" height="42" rx="12" fill="#E31E25" />
          <path d="M13 16c3 5 13 5 16 0" stroke="#ffffff" strokeWidth="2.8" strokeLinecap="round" fill="none" />
          <text
            x="21"
            y="30.5"
            textAnchor="middle"
            fill="#ffffff"
            fontSize="8.5"
            fontWeight="800"
            fontFamily="system-ui, sans-serif"
          >
            LinkAja
          </text>
        </svg>
      );

    case "emoney":
      return (
        <svg viewBox="0 0 42 42" className="brand-mark-svg" aria-hidden="true">
          <rect width="42" height="42" rx="12" fill="#1E293B" />
          <rect x="7" y="11" width="28" height="20" rx="3.5" fill="#0F172A" stroke="#F59E0B" strokeWidth="1.5" />
          <rect x="11" y="16" width="7" height="5.5" rx="1.2" fill="#FBBF24" />
          <path d="M26 16a5 5 0 0 1 0 6M29 14.5a7.5 7.5 0 0 1 0 9" stroke="#38BDF8" strokeWidth="1.7" strokeLinecap="round" fill="none" />
          <text
            x="16.5"
            y="27.5"
            fill="#F8FAFC"
            fontSize="5.8"
            fontWeight="800"
            fontFamily="system-ui, sans-serif"
          >
            e-MONEY
          </text>
        </svg>
      );

    case "bibit":
      return (
        <svg viewBox="0 0 42 42" className="brand-mark-svg" aria-hidden="true">
          <rect width="42" height="42" rx="12" fill="#00AB6B" />
          <path d="M21 22v-9M21 15c-4.5-4.5-9-1-7 3.5 1.5 3 5.5 2 7-3.5ZM21 17c4.5-4.5 9-1 7 3.5-1.5 3-5.5 2-7-3.5Z" stroke="#ffffff" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          <text
            x="21"
            y="33"
            textAnchor="middle"
            fill="#ffffff"
            fontSize="8.8"
            fontWeight="800"
            fontFamily="system-ui, sans-serif"
          >
            bibit
          </text>
        </svg>
      );

    case "ajaib":
      return (
        <svg viewBox="0 0 42 42" className="brand-mark-svg" aria-hidden="true">
          <rect width="42" height="42" rx="12" fill="#1D4ED8" />
          <path d="M21 10l7.5 17h-3.8l-1.5-3.6h-4.4L17.3 27h-3.8L21 10Zm-1.1 9.8h2.2L21 16.8l-1.1 3Z" fill="#ffffff" />
          <circle cx="30" cy="12" r="2.2" fill="#38BDF8" />
          <text
            x="21"
            y="34.5"
            textAnchor="middle"
            fill="#DBEAFE"
            fontSize="7.5"
            fontWeight="800"
            fontFamily="system-ui, sans-serif"
          >
            AJAIB
          </text>
        </svg>
      );

    case "stockbit":
      return (
        <svg viewBox="0 0 42 42" className="brand-mark-svg" aria-hidden="true">
          <rect width="42" height="42" rx="12" fill="#0F172A" />
          <path d="M11 26l6-6 4 4 9-10" stroke="#10B981" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          <circle cx="30" cy="14" r="2.6" fill="#34D399" />
          <text
            x="21"
            y="34.5"
            textAnchor="middle"
            fill="#ffffff"
            fontSize="7.4"
            fontWeight="800"
            fontFamily="system-ui, sans-serif"
          >
            Stockbit
          </text>
        </svg>
      );

    case "bareksa":
      return (
        <svg viewBox="0 0 42 42" className="brand-mark-svg" aria-hidden="true">
          <rect width="42" height="42" rx="12" fill="#15803D" />
          <rect x="11" y="20" width="4" height="9" rx="1.5" fill="#BBF7D0" />
          <rect x="18.5" y="15" width="4" height="14" rx="1.5" fill="#86EFAC" />
          <rect x="26" y="10" width="4" height="19" rx="1.5" fill="#FDE047" />
          <text
            x="21"
            y="36"
            textAnchor="middle"
            fill="#ffffff"
            fontSize="7.2"
            fontWeight="800"
            fontFamily="system-ui, sans-serif"
          >
            bareksa
          </text>
        </svg>
      );

    case "pluang":
      return (
        <svg viewBox="0 0 42 42" className="brand-mark-svg" aria-hidden="true">
          <rect width="42" height="42" rx="12" fill="#1E3A8A" />
          <circle cx="21" cy="17.5" r="7.5" fill="#FBBF24" />
          <text
            x="21"
            y="21"
            textAnchor="middle"
            fill="#1E3A8A"
            fontSize="10"
            fontWeight="900"
            fontFamily="system-ui, sans-serif"
          >
            P
          </text>
          <text
            x="21"
            y="34"
            textAnchor="middle"
            fill="#ffffff"
            fontSize="7.8"
            fontWeight="800"
            fontFamily="system-ui, sans-serif"
          >
            Pluang
          </text>
        </svg>
      );

    case "pintu":
      return (
        <svg viewBox="0 0 42 42" className="brand-mark-svg" aria-hidden="true">
          <rect width="42" height="42" rx="12" fill="#2563EB" />
          <path d="M14 29V16a7 7 0 0 1 14 0v13h-4.2V16a2.8 2.8 0 0 0-5.6 0v13H14Z" fill="#ffffff" />
          <circle cx="23.5" cy="22.5" r="1.5" fill="#93C5FD" />
        </svg>
      );

    case "cash":
      return (
        <svg viewBox="0 0 42 42" className="brand-mark-svg" aria-hidden="true">
          <rect width="42" height="42" rx="12" fill="#0D9488" />
          <rect x="8" y="13" width="26" height="16" rx="3" fill="#CCFBF1" stroke="#ffffff" strokeWidth="1.5" />
          <circle cx="21" cy="21" r="4" fill="#0D9488" />
        </svg>
      );

    default:
      return null;
  }
}

export function ProviderBrandMark({
  mark,
  size = "md",
}: {
  mark: Pick<ResolvedProviderMark, "monogram" | "tone" | "matchedKey">;
  size?: "sm" | "md";
}) {
  const svg = renderBrandSvg(mark.matchedKey);
  if (svg) {
    return (
      <span
        className={`finance-asset-mark finance-asset-mark--brand${size === "sm" ? " finance-asset-mark--sm" : ""}`}
        data-tone={mark.tone}
        data-brand={mark.matchedKey ?? undefined}
        aria-hidden="true"
      >
        {svg}
      </span>
    );
  }
  return (
    <span
      className={`finance-asset-mark${size === "sm" ? " finance-asset-mark--sm" : ""}`}
      data-tone={mark.tone}
      aria-hidden="true"
    >
      {mark.monogram}
    </span>
  );
}
