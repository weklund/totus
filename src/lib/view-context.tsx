"use client";

import { createContext, useContext } from "react";
import type { ViewContextValue } from "@/types/view-context";

const ViewContext = createContext<ViewContextValue | null>(null);

export function ViewContextProvider({
  value,
  children,
}: {
  value: ViewContextValue;
  children: React.ReactNode;
}) {
  return <ViewContext.Provider value={value}>{children}</ViewContext.Provider>;
}

export function useViewContext(): ViewContextValue {
  const ctx = useContext(ViewContext);
  if (!ctx) {
    throw new Error("useViewContext must be used within a ViewContextProvider");
  }
  return ctx;
}
