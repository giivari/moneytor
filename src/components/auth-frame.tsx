import { BrandIdentity } from "./brand-identity";

export function AuthFrame({ children }: { children: React.ReactNode }) {
  return <main id="main-content" className="auth-page"><div className="auth-card"><div className="auth-brand"><BrandIdentity /></div>{children}</div></main>;
}
