/**
 * PayPal Billing Subscriptions transaction list.
 * GET /v1/billing/subscriptions/{id}/transactions requires start_time and
 * end_time. The response may continue through links; a later page is followed
 * only when its URL stays on the configured PayPal API origin and this
 * subscription's transactions path. The caller attaches its own bearer token
 * to that validated URL and never forwards the token to an arbitrary href.
 */

export interface PayPalSubscriptionTransaction {
  id?: string;
  status?: string;
  time?: string;
  amount_with_breakdown?: {
    gross_amount?: { currency_code?: string; value?: string };
  };
}

export interface PayPalTransactionListPage {
  transactions?: PayPalSubscriptionTransaction[];
  total_items?: number;
  total_pages?: number;
  links?: { href?: string; rel?: string; method?: string }[];
}

export function paypalTransactionsUrl(
  apiBase: string,
  subscriptionId: string,
  startTime: string,
  endTime: string,
): string {
  if (!subscriptionId || !startTime || !endTime) {
    throw new Error(
      'PayPal transactions query requires a subscription id, start_time and end_time',
    );
  }
  const base = paypalApiBase(apiBase);
  const url = new URL(
    `/v1/billing/subscriptions/${encodeURIComponent(subscriptionId)}/transactions`,
    base,
  );
  url.searchParams.set('start_time', startTime);
  url.searchParams.set('end_time', endTime);
  assertTransactionsUrl(url, base, subscriptionId);
  return url.toString();
}

/** Returns the next page URL, or null when the official page has no next link. */
export function nextPayPalTransactionsUrl(params: {
  apiBase: string;
  subscriptionId: string;
  links?: { href?: string; rel?: string }[];
}): string | null {
  const next = params.links?.find((link) => link.rel === 'next' && link.href);
  if (!next?.href) return null;
  const base = paypalApiBase(params.apiBase);
  let url: URL;
  try {
    url = new URL(next.href, base);
  } catch {
    throw new Error('PayPal transactions next link is not a URL');
  }
  assertTransactionsUrl(url, base, params.subscriptionId);
  if (!url.searchParams.get('start_time') || !url.searchParams.get('end_time')) {
    throw new Error('PayPal transactions next link is missing the official time window');
  }
  return url.toString();
}

export async function readPayPalSubscriptionTransactions(params: {
  apiBase: string;
  subscriptionId: string;
  startTime: string;
  endTime: string;
  transport: (url: string) => Promise<PayPalTransactionListPage>;
}): Promise<PayPalSubscriptionTransaction[]> {
  const seen = new Set<string>();
  let url: string | null = paypalTransactionsUrl(
    params.apiBase,
    params.subscriptionId,
    params.startTime,
    params.endTime,
  );
  const collected: PayPalSubscriptionTransaction[] = [];
  let pages = 0;
  let reportedPages: number | null = null;
  let reportedItems: number | null = null;

  while (url) {
    if (seen.has(url)) throw new Error('PayPal transactions pagination repeated a page');
    seen.add(url);
    pages += 1;
    const page = await params.transport(url);
    if (typeof page.total_pages === 'number') {
      if (!Number.isSafeInteger(page.total_pages) || page.total_pages < 0) {
        throw new Error('PayPal transactions total_pages is not a usable count');
      }
      if (reportedPages == null) reportedPages = page.total_pages;
      else if (reportedPages !== page.total_pages) {
        throw new Error('PayPal transactions total_pages changed during pagination');
      }
    }
    if (typeof page.total_items === 'number') {
      if (!Number.isSafeInteger(page.total_items) || page.total_items < 0) {
        throw new Error('PayPal transactions total_items is not a usable count');
      }
      if (reportedItems == null) reportedItems = page.total_items;
      else if (reportedItems !== page.total_items) {
        throw new Error('PayPal transactions total_items changed during pagination');
      }
    }
    if (reportedPages != null && reportedPages > 0 && pages > reportedPages) {
      throw new Error('PayPal transactions page count exceeded total_pages');
    }
    collected.push(...(page.transactions ?? []));
    url = nextPayPalTransactionsUrl({
      apiBase: params.apiBase,
      subscriptionId: params.subscriptionId,
      links: page.links,
    });
  }

  if (reportedPages === 0) {
    if (pages !== 1 || collected.length !== 0) {
      throw new Error('PayPal transactions reported no pages but returned data');
    }
  } else if (reportedPages != null && pages !== reportedPages) {
    throw new Error('PayPal transactions read ended before total_pages');
  }
  if (reportedItems != null && collected.length !== reportedItems) {
    throw new Error('PayPal transactions count does not match total_items');
  }
  return collected;
}

function paypalApiBase(apiBase: string): URL {
  let base: URL;
  try {
    base = new URL(apiBase);
  } catch {
    throw new Error('PayPal API base is not a URL');
  }
  if (base.protocol !== 'https:' || base.username || base.password) {
    throw new Error('PayPal API base must be https and must not contain credentials');
  }
  return base;
}

function assertTransactionsUrl(url: URL, base: URL, subscriptionId: string): void {
  if (url.protocol !== 'https:') throw new Error('PayPal transactions URL is not https');
  if (url.username || url.password) {
    throw new Error('PayPal transactions URL contains credentials');
  }
  if (url.origin !== base.origin) {
    throw new Error('PayPal transactions URL origin is not the configured API');
  }
  const parts = url.pathname.split('/');
  if (
    parts.length !== 6 ||
    parts[1] !== 'v1' ||
    parts[2] !== 'billing' ||
    parts[3] !== 'subscriptions' ||
    parts[5] !== 'transactions' ||
    decodeURIComponent(parts[4] ?? '') !== subscriptionId
  ) {
    throw new Error(
      'PayPal transactions URL is not this subscription transactions endpoint',
    );
  }
}
