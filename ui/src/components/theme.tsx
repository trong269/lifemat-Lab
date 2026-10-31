import React, { createContext, useContext, useEffect, useState } from "react";

const Ctx = createContext<{ dark: boolean; toggle: () => void }>({ dark: false, toggle: () => {} });

function initial(): boolean {
  try {
    const t = localStorage.getItem("lml-theme");
    if (t === "dark") return true;
    if (t === "light") return false;
  } catch {
    /* bỏ qua */
  }
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [dark, setDark] = useState(initial);
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
  }, [dark]);
  const toggle = () =>
    setDark((d) => {
      try {
        localStorage.setItem("lml-theme", d ? "light" : "dark");
      } catch {
        /* bỏ qua */
      }
      return !d;
    });
  return <Ctx.Provider value={{ dark, toggle }}>{children}</Ctx.Provider>;
}

export const useTheme = () => useContext(Ctx);
