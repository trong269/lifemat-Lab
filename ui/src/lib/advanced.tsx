/* Chế độ nâng cao: bật thì hiện lại toàn bộ công cụ chi tiết trong menu. Lưu trong localStorage. */
import React, { createContext, useContext, useState } from "react";

const Ctx = createContext<{ advanced: boolean; setAdvanced: (v: boolean) => void }>({ advanced: false, setAdvanced: () => {} });

function initial(): boolean {
  try {
    return localStorage.getItem("lml-advanced") === "1";
  } catch {
    return false;
  }
}

export function AdvancedProvider({ children }: { children: React.ReactNode }) {
  const [advanced, set] = useState(initial);
  const setAdvanced = (v: boolean) => {
    try {
      localStorage.setItem("lml-advanced", v ? "1" : "0");
    } catch {
      /* bỏ qua */
    }
    set(v);
  };
  return <Ctx.Provider value={{ advanced, setAdvanced }}>{children}</Ctx.Provider>;
}

export const useAdvanced = () => useContext(Ctx);
