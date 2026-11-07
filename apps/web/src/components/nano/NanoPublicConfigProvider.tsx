"use client";

import { createContext, useContext } from "react";
import { assertPublicNanoConfig } from "./contract";
import type { NanoPublicConfig } from "./types";

const NanoPublicConfigContext = createContext<NanoPublicConfig | null>(null);

/**
 * The server basic layout resolves the safe public DTO once. Navigation, the
 * home CTA and the Nano studio read the same `enabled` value; read/cancel and
 * history remain available when new admission is closed.
 */
export function NanoPublicConfigProvider({
  config,
  children,
}: {
  config: NanoPublicConfig;
  children: React.ReactNode;
}) {
  return (
    <NanoPublicConfigContext.Provider
      value={assertPublicNanoConfig(config)}
    >
      {children}
    </NanoPublicConfigContext.Provider>
  );
}

export function useNanoPublicConfig(): NanoPublicConfig | null {
  return useContext(NanoPublicConfigContext);
}
