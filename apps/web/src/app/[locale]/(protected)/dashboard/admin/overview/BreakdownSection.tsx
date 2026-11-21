/**
 * [INPUT]: Depends on @/actions/overview's getOverviewBreakdowns/BreakdownItem,
 *          @/actions/overview/range's OverviewRange, @/config/pricing's
 *          getPlanName/PaymentProvider, ./BreakdownList, ./SectionError,
 *          @/lib/format's formatCents/formatNumber, next-intl/server
 * [OUTPUT]: exports BreakdownSection (async Server Component), BreakdownSkeleton
 * [POS]: The third row of admin/overview — revenue by plan / revenue by
 *        provider / signups by source; this file only translates "key →
 *        readable label", leaving the layout to BreakdownList
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */

import { getOverviewBreakdowns, type BreakdownItem } from "@/actions/overview";
import type { OverviewRange } from "@/actions/overview/range";
import { getPlanName, type PaymentProvider } from "@/config/pricing";
import { formatCents, formatNumber } from "@/lib/format";
import { getLocale, getTranslations } from "next-intl/server";
import { BreakdownList, BreakdownListSkeleton, type BreakdownRow } from "./BreakdownList";
import { SectionError } from "./SectionError";

const GRID = "grid gap-4 md:grid-cols-3";

// Brand names need no i18n
const PROVIDER_LABELS: Record<PaymentProvider, string> = {
  stripe: "Stripe",
  paypal: "PayPal",
  creem: "Creem",
};

export async function BreakdownSection({ range }: { range: OverviewRange }) {
  const [result, t, locale] = await Promise.all([
    getOverviewBreakdowns(range),
    getTranslations("Overview"),
    getLocale(),
  ]);

  if (!result.success || !result.data) {
    return (
      <SectionError
        message={result.success ? t("error.empty") : result.error || t("error.load")}
      />
    );
  }

  const { currency, revenueByPlan, revenueByProvider, signupsBySource } = result.data;
  const other = t("breakdown.other");

  // Each card = one "key → label" resolver + one value formatter
  const toRows = (
    items: BreakdownItem[],
    labelOf: (key: string) => string,
    format: (value: number) => string
  ): BreakdownRow[] =>
    items.map((i) => ({
      key: i.key,
      label: i.key === "__other__" ? other : labelOf(i.key),
      value: i.value,
      formatted: format(i.value),
    }));

  const money = (cents: number) => formatCents(cents, currency, locale);
  const num = (n: number) => formatNumber(n, locale);
  const empty = t("breakdown.empty");

  return (
    <div className={GRID}>
      <BreakdownList
        title={t("breakdown.revenueByPlan")}
        rows={toRows(revenueByPlan, (id) => getPlanName(id, locale), money)}
        emptyText={empty}
      />
      <BreakdownList
        title={t("breakdown.revenueByProvider")}
        rows={toRows(
          revenueByProvider,
          (p) => PROVIDER_LABELS[p as PaymentProvider] ?? p,
          money
        )}
        emptyText={empty}
      />
      <BreakdownList
        title={t("breakdown.signupsBySource")}
        rows={toRows(
          signupsBySource,
          (s) => (s === "direct" ? t("breakdown.direct") : s),
          num
        )}
        emptyText={empty}
      />
    </div>
  );
}

export function BreakdownSkeleton() {
  return (
    <div className={GRID}>
      {[0, 1, 2].map((i) => (
        <BreakdownListSkeleton key={i} />
      ))}
    </div>
  );
}
