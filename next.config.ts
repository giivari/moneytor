import type { NextConfig } from "next";

const config: NextConfig = {
  devIndicators: false,
  experimental: {
    optimizePackageImports: ["@phosphor-icons/react", "@phosphor-icons/react/dist/ssr"],
    // Router cache client: halaman yang dikunjungi dipakai ulang 30 dtk, prefetch penuh (hover/sentuh) 60 dtk.
    // Mutasi tetap segar karena refresh() memanggil router.refresh(), yang mengosongkan cache ini.
    staleTimes: { dynamic: 30, static: 60 },
  },
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "X-DNS-Prefetch-Control", value: "off" },
      { key: "Referrer-Policy", value: "same-origin" },
      { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
      { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
      { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), publickey-credentials-get=(self), publickey-credentials-create=(self)" },
      // Compatible baseline; strict script CSP needs a separately verified nonce setup.
      { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'" },
    ] }];
  },
};
export default config;
