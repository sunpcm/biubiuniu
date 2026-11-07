import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  nextPayPalTransactionsUrl,
  paypalTransactionsUrl,
  readPayPalSubscriptionTransactions,
} from '@/lib/paypal/transactions';

const base = 'https://api-m.sandbox.paypal.com';
const id = 'I-SUB';

test('PayPal transaction queries keep the bearer on the configured transactions path', async () => {
  const first = paypalTransactionsUrl(base, id, '2026-01-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z');
  const seen: string[] = [];
  const rows = await readPayPalSubscriptionTransactions({
    apiBase: base,
    subscriptionId: id,
    startTime: '2026-01-01T00:00:00.000Z',
    endTime: '2026-02-01T00:00:00.000Z',
    transport: async (url) => {
      seen.push(url);
      if (seen.length === 1) {
        assert.equal(url, first);
        return {
          total_items: 2,
          total_pages: 2,
          transactions: [{ id: 'SALE-1', status: 'COMPLETED', time: '2026-01-02T00:00:00.000Z',
            amount_with_breakdown: { gross_amount: { currency_code: 'USD', value: '10.00' } } }],
          links: [{ rel: 'next', href: `${base}/v1/billing/subscriptions/${id}/transactions?start_time=2026-01-01T00%3A00%3A00.000Z&end_time=2026-02-01T00%3A00%3A00.000Z&page=2` }],
        };
      }
      return {
        total_items: 2,
        total_pages: 2,
        transactions: [{ id: 'SALE-2', status: 'DECLINED', time: '2026-01-03T00:00:00.000Z' }],
      };
    },
  });
  assert.equal(rows.length, 2);
  assert.equal(seen.length, 2);
  assert.equal(new URL(seen[1]).origin, base);
  assert.throws(() => nextPayPalTransactionsUrl({
    apiBase: base,
    subscriptionId: id,
    links: [{ rel: 'next', href: 'https://evil.example/v1/billing/subscriptions/I-SUB/transactions?start_time=a&end_time=b' }],
  }), /origin/);
  assert.throws(() => nextPayPalTransactionsUrl({
    apiBase: base,
    subscriptionId: id,
    links: [{ rel: 'next', href: `${base}/v1/billing/subscriptions/OTHER/transactions?start_time=a&end_time=b` }],
  }), /subscription/);
  await assert.rejects(() => readPayPalSubscriptionTransactions({
    apiBase: base,
    subscriptionId: id,
    startTime: '2026-01-01T00:00:00.000Z',
    endTime: '2026-02-01T00:00:00.000Z',
    transport: async () => ({ total_pages: 2, transactions: [{ id: 'ONLY' }] }),
  }), /before total_pages/);
});
