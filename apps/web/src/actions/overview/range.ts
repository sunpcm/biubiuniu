/**
 * [INPUT]: No external dependencies — pure date arithmetic
 * [OUTPUT]: exports OverviewRange, OVERVIEW_RANGES, DEFAULT_RANGE, parseRange,
 *           resolveWindow, OverviewWindow, DAY_MS, utcDayKey
 * [POS]: Time-window source of truth for actions/overview; a 'use server' module
 *        may only export async functions, so the constants and the synchronous
 *        parser live in their own file, shared by page.tsx and index.ts
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */

// ────────────────────────────────────────────────────────────────
//  Time windows — always aligned to UTC calendar days.
//  Current window = [start, now): the last N calendar days, today (partial) included;
//  Comparison window = [prevStart, start): the N full days immediately before it.
//  Every stat (KPI / trend / breakdown / attention) shares the same window,
//  the page has a single filter, so two charts can never disagree on scope.
// ────────────────────────────────────────────────────────────────

export const OVERVIEW_RANGES = ['7d', '30d', '90d'] as const
export type OverviewRange = (typeof OVERVIEW_RANGES)[number]
export const DEFAULT_RANGE: OverviewRange = '30d'

export const DAY_MS = 86_400_000

const RANGE_DAYS: Record<OverviewRange, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
}

export interface OverviewWindow {
  range: OverviewRange
  days: number
  /** Current window start (UTC midnight) */
  start: Date
  /** Comparison window start (UTC midnight); its end is exactly `start` */
  prevStart: Date
  /** Current window end = the moment of the call */
  end: Date
}

/** Unknown/missing ranges always fall back to the default — callers need no null check */
export function parseRange(value: string | string[] | undefined): OverviewRange {
  return OVERVIEW_RANGES.find((r) => r === value) ?? DEFAULT_RANGE
}

export function resolveWindow(range: OverviewRange, now = new Date()): OverviewWindow {
  const days = RANGE_DAYS[range]
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  const start = new Date(todayUtc - (days - 1) * DAY_MS)
  const prevStart = new Date(start.getTime() - days * DAY_MS)
  return { range, days, start, prevStart, end: now }
}

/** Date → 'YYYY-MM-DD' (UTC), aligned with the SQL-side to_char(... AT TIME ZONE 'UTC') */
export function utcDayKey(date: Date): string {
  return date.toISOString().slice(0, 10)
}
