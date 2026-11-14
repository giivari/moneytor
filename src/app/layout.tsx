import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { AppShell } from "@/components/app-shell";
import { FinanceFeedbackProvider } from "@/components/finance-feedback";
import "./tokens.css";
import "./globals.css";
import "./shell.css";
import "./ui.css";
import "./visual.css";
import "./auth.css";
import "./finance.css";
import "./settings.css";
import "./responsive.css";
import "./investments.css";
import "./interaction.css";
import "./planning.css";
import "./automation.css";
import "./forms.css";
import "./density.css";
import "./typography.css";
import "./data-presentation.css";
import "./home.css";
import "./onboarding.css";

const inter = Inter({ subsets: ["latin"], display: "swap", variable: "--font-inter" });
// Runs before first paint so dark-mode users never see a light flash; falls back to the system preference.
const THEME_SCRIPT = 'try{var t=localStorage.getItem("moneytor-theme");if(!t&&matchMedia("(prefers-color-scheme: dark)").matches)t="dark";document.documentElement.setAttribute("data-theme",t==="dark"?"dark":"light")}catch(e){}';

export const viewport: Viewport = {
  themeColor: "#0f6cbd",
  width: "device-width",
  initialScale: 1,
};

export const metadata: Metadata = {
  title: "moneytor — Monitor Keuangan Pribadi",
  description: "Monitor keuangan pribadi yang privat",
  applicationName: "moneytor",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "moneytor",
  },
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="id" className={inter.variable} data-scroll-behavior="smooth" suppressHydrationWarning><head><script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} /></head><body suppressHydrationWarning><a className="skip-link" href="#main-content">Lewati ke konten</a><FinanceFeedbackProvider><AppShell>{children}</AppShell></FinanceFeedbackProvider></body></html>;
}
