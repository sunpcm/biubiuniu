/**
 * Product-owned display switches. Nano's public state comes from the approved
 * server-only DTO passed through the basic layout, never from a client import
 * of the feature/server configuration. Other switches here only control
 * optional presentation.
 */

export function isWechatDonateEnabled(): boolean {
  return process.env.NEXT_PUBLIC_SHOW_WECHAT_DONATE === "true";
}
