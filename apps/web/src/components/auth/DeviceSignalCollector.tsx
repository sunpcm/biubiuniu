/**
 * [INPUT]: Depends on @/lib/signup-gift-gate/client's saveDeviceSignal
 * [OUTPUT]: Exports DeviceSignalCollector (collects the device fingerprint into a
 *           cookie on mount, renders no DOM)
 * [POS]: A global auth behaviour component of components/auth, mounted in the
 *        root layout next to GoogleOneTap / ImpersonationBanner; the client touch
 *        point of the signup-gift gate. Google One Tap, the login dialog and
 *        /login all pass through the root layout
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */
"use client";

import { saveDeviceSignal } from "@/lib/signup-gift-gate/client";
import { useEffect } from "react";

export function DeviceSignalCollector() {
  useEffect(() => {
    void saveDeviceSignal();
  }, []);

  return null;
}
