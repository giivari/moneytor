import Image from "next/image";

/** Shared wordmark; uses the real icon.png plus wordmark as requested. */
export function BrandIdentity() {
  return (
    <span className="brand-identity">
      <Image
        src="/icon.png"
        alt="moneytor"
        width={28}
        height={28}
        className="brand-logo-img"
        priority
      />
      <span className="brand-wordmark">moneytor</span>
    </span>
  );
}
