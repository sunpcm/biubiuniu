import assert from "node:assert/strict";
import test from "node:test";
import Stripe from "stripe";
import {
  createStripeProvider,
  type StripeWebhookClient,
} from "@sunpcm/niu-commerce/providers/stripe";

type ProviderCommerce = Parameters<typeof createStripeProvider>[0]["commerce"];

function providerCommerce(): ProviderCommerce {
  return {
    runtime: {
      log() {},
      deps: { productId: "public-type-fixture" },
    },
  } as unknown as ProviderCommerce;
}

test("published Commerce Stripe types accept the real Stripe class without client casts", async () => {
  const secret = "{{SECRET_zb2d6wzi}}";
  const stripe = new Stripe("sk_test_public_type_fixture_only");
  const client: StripeWebhookClient = stripe;
  const provider = await createStripeProvider({
    commerce: providerCommerce(),
    client: new Stripe("sk_test_public_type_fixture_only"),
    webhookSecret: secret,
    catalog: {
      getPlanById: () => undefined,
      findPlanByProviderPriceId: () => undefined,
    },
  });

  assert.equal(typeof client.webhooks.constructEvent, "function");
  assert.equal(typeof provider.webhook, "function");
});

test("real Stripe Event keeps non-record data.object values usable behind the public boundary", async () => {
  const secret = "{{SECRET_zb2d6wzi}}";
  const stripe = new Stripe("sk_test_public_type_fixture_only");
  const payload = JSON.stringify({
    id: "evt_public_type_fixture",
    object: "event",
    api_version: "2025-08-27.basil",
    created: 1_700_000_000,
    data: {
      object: {
        id: "app_public_type_fixture",
        object: "application",
      },
    },
    livemode: false,
    pending_webhooks: 0,
    request: null,
    type: "application.created",
  });
  const signature = stripe.webhooks.generateTestHeaderString({ payload, secret });
  const event = stripe.webhooks.constructEvent(payload, signature, secret);
  const provider = await createStripeProvider({
    commerce: providerCommerce(),
    client: new Stripe("sk_test_public_type_fixture_only"),
    webhookSecret: secret,
    catalog: {
      getPlanById: () => undefined,
      findPlanByProviderPriceId: () => undefined,
    },
  });

  assert.equal(event.data.object.object, "application");
  assert.deepEqual(await provider.webhook()(payload, signature), {
    status: 200,
    body: { received: true },
  });

  const invalidPayload = JSON.stringify({
    id: "evt_invalid_data_object",
    object: "event",
    api_version: "2025-08-27.basil",
    created: 1_700_000_000,
    data: { object: null },
    livemode: false,
    pending_webhooks: 0,
    request: null,
    type: "checkout.session.completed",
  });
  const invalidSignature = stripe.webhooks.generateTestHeaderString({
    payload: invalidPayload,
    secret,
  });
  assert.deepEqual(await provider.webhook()(invalidPayload, invalidSignature), {
    status: 500,
    body: { error: "Failed to process Stripe webhook." },
  });
});
