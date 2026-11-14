export function BrandIdentity() {
  return (
    <span className="brand-identity">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/icon-192.png"
        alt=""
        width={18}
        height={18}
        className="brand-logo-img"
        decoding="async"
      />
      <span className="brand-wordmark">moneytor</span>
    </span>
  );
}
