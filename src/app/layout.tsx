import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { AppShell } from "@/components/app-shell";
import { FinanceFeedbackProvider } from "@/components/finance-feedback";
import "./globals.css";
import "./shell.css";
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
export const metadata: Metadata = { title: "moneytor — Monitor Keuangan Pribadi", description: "Monitor keuangan pribadi yang privat" };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="id" className={inter.variable} data-scroll-behavior="smooth"><body><a className="skip-link" href="#main-content">Lewati ke konten</a><FinanceFeedbackProvider><AppShell>{children}</AppShell></FinanceFeedbackProvider></body></html>;
}
