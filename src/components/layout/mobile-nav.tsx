"use client";

// モバイル時のサイドバー（ドロワー）開閉状態を Header と Sidebar で共有する。
import { createContext, useContext, useState, useCallback } from "react";

type MobileNavContextValue = {
  open: boolean;
  openNav: () => void;
  closeNav: () => void;
  toggleNav: () => void;
};

const MobileNavContext = createContext<MobileNavContextValue | null>(null);

export function MobileNavProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const openNav = useCallback(() => setOpen(true), []);
  const closeNav = useCallback(() => setOpen(false), []);
  const toggleNav = useCallback(() => setOpen((v) => !v), []);
  return (
    <MobileNavContext.Provider value={{ open, openNav, closeNav, toggleNav }}>
      {children}
    </MobileNavContext.Provider>
  );
}

export function useMobileNav(): MobileNavContextValue {
  const ctx = useContext(MobileNavContext);
  if (!ctx) {
    // Provider外でも安全に動作（no-op）
    return { open: false, openNav: () => {}, closeNav: () => {}, toggleNav: () => {} };
  }
  return ctx;
}
