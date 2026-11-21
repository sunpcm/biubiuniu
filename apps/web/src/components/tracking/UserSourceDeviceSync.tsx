/**
 * [INPUT]: Depends on @/lib/tracking/client's syncTrackingDeviceInfo
 * [OUTPUT]: Exports UserSourceDeviceSync (on mount it tops the screen /
 *           language / timezone fields into the attribution cookie; renders no DOM)
 * [POS]: The signup-attribution touchpoint of components/tracking, mounted in
 *        the root layout in the same slot as DeviceSignalCollector; the
 *        attribution block is written by the proxy, this only adds the device
 *        block that the browser alone knows
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */

"use client";

import { syncTrackingDeviceInfo } from "@/lib/tracking/client";
import { useEffect } from "react";

export function UserSourceDeviceSync() {
  useEffect(() => {
    syncTrackingDeviceInfo();
  }, []);

  return null;
}
