import { SpinnerGap } from "@phosphor-icons/react/dist/ssr";

export function LoadingIndicator({ children = "Memuat…" }: { children?: React.ReactNode }) {
  return <span className="loading-indicator"><SpinnerGap size={18} className="loading-spinner" aria-hidden="true" /><span>{children}</span></span>;
}
