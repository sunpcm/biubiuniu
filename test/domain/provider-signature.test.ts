import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import type Stripe from 'stripe'

// A synthetic, clearly-fake key is enough to construct the Stripe singleton.
// constructEvent is pure HMAC validation over the payload — no network call
// and no real credential is involved. The SDK is loaded in before() because
// the root domain runner compiles this file as CJS, which rejects top-level await.
process.env.STRIPE_SECRET_KEY = 'sk_test_fake_signature_test_key'
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_fake_signature_test_secret'

let stripe: Stripe | null = null

before(async () => {
  const loaded = await import('@/lib/stripe')
  stripe = loaded.stripe
})

const WEBHOOK_SECRET = 'whsec_fake_signature_test_secret'

test('Stripe webhook constructEvent rejects a bad signature', () => {
  assert.ok(stripe, 'stripe client should be constructed for the synthetic key')
  const payload = JSON.stringify({ type: 'checkout.session.completed' })
  assert.throws(() =>
    stripe!.webhooks.constructEvent(payload, 't=0,v1=deadbeef', WEBHOOK_SECRET)
  )
})

test('Stripe webhook constructEvent accepts a valid signature', () => {
  assert.ok(stripe)
  const payload = JSON.stringify({
    type: 'checkout.session.completed',
    data: { object: { id: 'cs_test_1' } },
  })
  const timestamp = Math.floor(Date.now() / 1000)
  const hmac = createHmac('sha256', WEBHOOK_SECRET)
  hmac.update(`${timestamp}.${payload}`)
  const signature = `t=${timestamp},v1=${hmac.digest('hex')}`
  const event = stripe!.webhooks.constructEvent(payload, signature, WEBHOOK_SECRET)
  assert.equal(event.type, 'checkout.session.completed')
})
