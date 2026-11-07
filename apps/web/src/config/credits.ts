/**
 * [INPUT]: None (pure business config)
 * [OUTPUT]: Exports creditsConfig (signupBonusCredits, the welcome gift, plus
 *           signupGiftClusterCaps, how many signups per source IP / device
 *           fingerprint may receive it inside the window)
 * [POS]: The credits operations config of config — complements pricing.ts
 *        (the paid credit mapping); only non-payment credit grant rules
 *        live here; the cluster caps are consumed by lib/signup-gift-gate
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */

// ============================================================================
// Credits operations config — non-payment credit grants live here.
//
// Same philosophy as config/pricing.ts: these are rare, deploy-worthy
// decisions that deserve code review, not a database admin panel.
// ============================================================================

export const creditsConfig = {
  /**
   * Welcome credits granted once when a user registers.
   * Set to 0 to disable. Granted into the purchased bucket, so the bonus
   * survives subscription resets and never expires.
   */
  signupBonusCredits: 30,

  /**
   * The welcome gift is granted per identity cluster, not per account. One
   * person cycling through throwaway emails and VPN exits gets a fresh
   * account each time, but not a fresh device or network exit. Each signal
   * counts on its own; once either passes its cap inside the window the new
   * account still registers, it just gets no gift.
   *
   *   perIp      Signups per source IP that may receive the gift inside the
   *              window. Campus networks, office NAT and carrier CGNAT put
   *              real people behind one IP, so this is not 1.
   *   perDevice  Signups per device fingerprint (hash of browser + screen +
   *              time zone + language + GPU and other hardware signals, which
   *              neither a VPN nor a private window changes). Two people
   *              sharing one computer is normal, hence 2.
   *   windowDays Counting window; counters expire on their own.
   *
   * Missing signals (no device cookie, no source IP) or a Redis failure always
   * let the gift through: the gate's own failure must never spoil a genuine
   * new user's first impression.
   */
  signupGiftClusterCaps: {
    perIp: 3,
    perDevice: 2,
    windowDays: 30,
  },
} as const
