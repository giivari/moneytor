"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "@phosphor-icons/react";
import { ICON_MD } from "./icon-size";

export function ThemeToggle() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    // The pre-paint script in layout.tsx already chose the theme (saved choice, else the system preference).
    setDark(document.documentElement.getAttribute("data-theme") === "dark");
  }, []);

  function toggle() {
    const next = !dark;
    setDark(next);
    const theme = next ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", theme);
    try {
      window.localStorage.setItem("moneytor-theme", theme);
    } catch {
      // Ignore storage restriction
    }
  }

  return (
    <button
      type="button"
      className="icon-button theme-toggle-trigger"
      onClick={toggle}
      aria-pressed={dark}
      aria-label={dark ? "Ubah ke mode terang" : "Ubah ke mode gelap"}
      title={dark ? "Mode terang" : "Mode gelap"}
    >
      {dark ? <Sun size={ICON_MD} weight="bold" /> : <Moon size={ICON_MD} weight="bold" />}
    </button>
  );
}
