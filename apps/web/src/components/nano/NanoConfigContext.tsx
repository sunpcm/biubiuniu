"use client";

import { createContext, useContext } from "react";
import type { NanoPublicConfig } from "./types";

const NanoConfigContext = createContext<Pick<NanoPublicConfig, "enabled"> | null>(
  null,
);

/**
 * Header/Hero only need the public `enabled` bit. The dashboard shell reuses
 * those shared components without the basic-layout provider; closed is the
 * conservative default there, and the full Nano page receives its own DTO.
 */
export function NanoConfigProvider({
  enabled,
  children,
}: {
  enabled: boolean;
  children: React.ReactNode;
}) {
  return (
    <NanoConfigContext.Provider value={{ enabled }}>
      {children}
    </NanoConfigContext.Provider>
  );
}

export function useNanoConfig(): Pick<NanoPublicConfig, "enabled"> {
  const config = useContext(NanoConfigContext);
  return config ?? { enabled: false };
}
