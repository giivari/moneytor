"use client";

import { useEffect, useState } from "react";
import { Moon, Sun, Monitor } from "@phosphor-icons/react";
import { ICON_MD } from "./icon-size";

export type ThemePreference = "light" | "dark" | "system";

const STORAGE_KEY = "moneytor-theme";

export function getStoredTheme(): ThemePreference {
  if (typeof window === "undefined") return "light";
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (value === "dark" || value === "system" || value === "light") return value;
  } catch {}
  return "light";
}

export function applyTheme(pref: ThemePreference) {
  try {
    localStorage.setItem(STORAGE_KEY, pref);
  } catch {}
  const isDark = pref === "dark" || (pref === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.setAttribute("data-theme", isDark ? "dark" : "light");
  window.dispatchEvent(new CustomEvent("moneytor-theme-change", { detail: pref }));
}

export function useTheme() {
  const [theme, setTheme] = useState<ThemePreference>("light");
  const [activeTheme, setActiveTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    const current = getStoredTheme();
    setTheme(current);
    const resolved = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
    setActiveTheme(resolved);

    const onThemeChange = (e: Event) => {
      const custom = e as CustomEvent<ThemePreference>;
      const pref = custom.detail ?? getStoredTheme();
      setTheme(pref);
      const isDark = pref === "dark" || (pref === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
      setActiveTheme(isDark ? "dark" : "light");
    };

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onSystemChange = () => {
      if (getStoredTheme() === "system") {
        document.documentElement.setAttribute("data-theme", media.matches ? "dark" : "light");
        setActiveTheme(media.matches ? "dark" : "light");
      }
    };

    window.addEventListener("moneytor-theme-change", onThemeChange);
    media.addEventListener("change", onSystemChange);
    return () => {
      window.removeEventListener("moneytor-theme-change", onThemeChange);
      media.removeEventListener("change", onSystemChange);
    };
  }, []);

  const setPreference = (pref: ThemePreference) => {
    applyTheme(pref);
    setTheme(pref);
    const isDark = pref === "dark" || (pref === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    setActiveTheme(isDark ? "dark" : "light");
  };

  return { theme, activeTheme, setPreference };
}

/** Quick toggle button in Top Header */
export function ThemeQuickToggle() {
  const { activeTheme, setPreference } = useTheme();

  const toggle = () => {
    setPreference(activeTheme === "dark" ? "light" : "dark");
  };

  return (
    <button
      type="button"
      onClick={toggle}
      className="icon-button header-theme-toggle"
      aria-label={`Ganti tema, saat ini mode ${activeTheme === "dark" ? "gelap" : "terang"}`}
      title={`Tema: ${activeTheme === "dark" ? "Gelap" : "Terang"} (Klik untuk beralih)`}
    >
      {activeTheme === "dark" ? <Moon size={ICON_MD} weight="fill" aria-hidden="true" /> : <Sun size={ICON_MD} weight="bold" aria-hidden="true" />}
    </button>
  );
}

/** Segmented options selector for Settings Page */
export function ThemeSelector() {
  const { theme, setPreference } = useTheme();

  return (
    <div className="theme-selector-panel" role="group" aria-label="Pilihan tema tampilan">
      <div className="theme-options-grid">
        <button
          type="button"
          onClick={() => setPreference("light")}
          className={`theme-option-btn ${theme === "light" ? "theme-option-btn--active" : ""}`}
          aria-pressed={theme === "light"}
        >
          <Sun size={20} weight={theme === "light" ? "fill" : "regular"} aria-hidden="true" />
          <div className="theme-option-text">
            <strong>Terang</strong>
            <small>Tampilan bawaan Microsoft 365</small>
          </div>
        </button>

        <button
          type="button"
          onClick={() => setPreference("dark")}
          className={`theme-option-btn ${theme === "dark" ? "theme-option-btn--active" : ""}`}
          aria-pressed={theme === "dark"}
        >
          <Moon size={20} weight={theme === "dark" ? "fill" : "regular"} aria-hidden="true" />
          <div className="theme-option-text">
            <strong>Gelap</strong>
            <small>Kontras seimbang dan nyaman di malam hari</small>
          </div>
        </button>

        <button
          type="button"
          onClick={() => setPreference("system")}
          className={`theme-option-btn ${theme === "system" ? "theme-option-btn--active" : ""}`}
          aria-pressed={theme === "system"}
        >
          <Monitor size={20} weight={theme === "system" ? "fill" : "regular"} aria-hidden="true" />
          <div className="theme-option-text">
            <strong>Ikuti sistem</strong>
            <small>Menyesuaikan otomatis dengan tema OS</small>
          </div>
        </button>
      </div>
    </div>
  );
}
