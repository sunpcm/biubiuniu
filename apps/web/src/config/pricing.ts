/**
 * [INPUT]: None (pure business configuration)
 * [OUTPUT]: Exports the PaymentProvider/ProviderPriceRef/PricingPlan/PlanCopy/
 *           PlanFeature/TeamSubscriptionPlan types, the pricingPlans list,
 *           pricingCampaign, the subscriptionPlans/personalSubscriptionPlans/
 *           teamSubscriptionPlans/creditPackPlans/activePricingPlans derived
 *           arrays, getPlanById/findPlanByProviderPriceId/getProviderPriceRef/
 *           isSubscriptionPlan/isTeamPlan/getPlanSeats/getPlanCredits/
 *           getPlanCopy/getPlanName/getAutoPromotionCode
 * [POS]: The pricing source of truth in config — plans, credits, price
 *        references for the three providers (stripe|creem|paypal) and the
 *        three-language copy are all defined here; the database stores no
 *        pricing and runtime code only reads this file
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */

// ============================================================================
// Pricing — single source of truth (code, not database)
//
// Why code instead of an admin panel:
//   - Pricing changes are rare, deploy-worthy events that deserve code review.
//   - The payment provider is the source of truth for money; this file only
//     maps a plan slug to a provider-side price/product/plan, the credits it
//     grants, and its card copy.
//   - Card copy (name, description, features) lives INLINE on each plan as
//     { en, zh, ja } — one plan is one object here, nothing scattered in i18n.
//
// Multi-provider model:
//   - Every plan declares `provider` — WHICH provider handles its checkout.
//   - The provider-side reference lives in the matching optional field:
//       stripe → stripePriceId   (Stripe Price id)
//       creem  → creemProductId  (Creem Product id)
//       paypal → paypalPlanId    (PayPal Billing Plan id — SUBSCRIPTIONS ONLY;
//                a paypal credit pack needs NO paypalPlanId, its one-time
//                order is created dynamically from `price`)
//
// How to add / change a plan:
//   1. Create the price/product/plan at the chosen provider (test and live).
//   2. Add or edit the plan entry below — provider refs, credits, and copy
//      all live in the same object.
//   3. Deploy. The pricing page, checkout, and webhooks all read this file.
//
// Promotions: set `pricingCampaign.promotionCode` (site-wide) or a plan-level
// `promotionCode` to auto-apply a promotion code at checkout. Create the same
// customer-facing code in both test and live mode. When no code is
// configured, checkout shows the provider's manual promo-code input instead.
//
// NOTE: never reuse a plan `id` for a different offer — orders and credit
// history reference plans by this slug forever.
// ============================================================================

/** Payment provider identifier — the single source of truth; the payment_provider enum in lib/db/schema.ts mirrors this type */
export type PaymentProvider = 'stripe' | 'creem' | 'paypal'

/** Provider-side reference, one value per provider environment. */
export interface ProviderPriceRef {
  /** Reference from the provider's test/sandbox mode */
  test: string
  /** Reference from the provider's live mode */
  live: string
}

/**
 * One feature row on a pricing card. Plain string renders muted; `**bold**`
 * segments render emphasized. The object form with `highlight: true` elevates
 * the whole row — reserved for team-exclusive perks (seats / shared pool /
 * per-member stats) so they pop against the shared baseline.
 */
export type PlanFeature =
  | string
  | {
    text: string
    highlight?: boolean
  }

export interface PlanCopy {
  name: string
  description: string
  features: PlanFeature[]
}

/** Per-locale card copy; `en` is mandatory and serves as the fallback. */
export type LocalizedPlanCopy = { en: PlanCopy } & Record<string, PlanCopy>

interface BasePlan {
  /** Stable slug, referenced by orders/subscriptions in the database */
  id: string
  /** Which payment provider handles checkout for this plan */
  provider: PaymentProvider
  /** Stripe Price id (test/live) — required when provider is 'stripe' */
  stripePriceId?: ProviderPriceRef
  /** Creem Product id (test/live) — required when provider is 'creem' */
  creemProductId?: ProviderPriceRef
  /**
   * PayPal Billing Plan id (test/live) — required when provider is 'paypal'
   * AND the plan is a subscription. PayPal one-time orders (credit packs) are
   * created dynamically from `price` and need no plan id.
   */
  paypalPlanId?: ProviderPriceRef
  /** Display price in major currency units (e.g. 9.9 = $9.90) */
  price: number
  /** ISO currency code for display; the charged currency comes from the provider */
  currency: string
  /** Card copy per locale — name, description, features */
  copy: LocalizedPlanCopy
  /** Optional strikethrough price for promotions */
  originalPrice?: number
  /**
   * Customer-facing promotion code (e.g. 'LAUNCH20') auto-applied at
   * checkout for this plan. Overrides `pricingCampaign.promotionCode`.
   */
  promotionCode?: string
  /** Highlight this card on the pricing page */
  popular?: boolean
  /** Hide from the pricing page without deleting (history keeps working) */
  active?: boolean
}

export interface SubscriptionPlan extends BasePlan {
  kind: 'subscription'
  interval: 'month' | 'year'
  /**
   * Who the plan is sold to. 'team' plans entitle an organization: credits
   * land in the org's shared pool and `seats` caps its member count.
   * Omitted = 'personal' (the overwhelmingly common case stays unmarked).
   */
  audience?: 'personal' | 'team'
  /** Seats included with a team plan (member cap, enforced at invite/join). */
  seats?: number
  /**
   * Credits granted per month. Subscription credits RESET to this value on
   * every grant (no rollover). Yearly plans drip this amount monthly.
   */
  monthlyCredits: number
  /** Optional trial period in days */
  trialDays?: number
}

export interface CreditPackPlan extends BasePlan {
  kind: 'credit_pack'
  /** One-time credits granted on purchase; they never expire */
  credits: number
}

export type PricingPlan = SubscriptionPlan | CreditPackPlan

// ----------------------------------------------------------------------------
// Campaign — the one volatile ops knob, kept separate from stable plan data.
// Set `promotionCode` to auto-apply a promotion code site-wide.
// ----------------------------------------------------------------------------

export interface PricingCampaign {
  /** Customer-facing promotion code auto-applied at every checkout */
  promotionCode?: string
}

export const pricingCampaign: PricingCampaign = {
  // promotionCode: 'LAUNCH20',
}

// ----------------------------------------------------------------------------
// Plan definitions — replace the placeholder provider references with your own.
//
// Iron rule: a plan entry that has ever been sold is **never physically
// deleted**; retiring one always means active:false. Every renewal/upgrade
// invoice of an existing subscription resolves its plan through this file
// (both paths — metadata.planId and the price id — land here). Delete the
// entry and webhook fulfillment throws on every invoice → 5xx → Stripe retries
// with exponential backoff for up to 3 days, mailing the admin a grant-failure
// alert on every attempt. active:false only affects the pricing page; historical
// resolution keeps working.
//
// Creem plan example (subscription — provider ref is a Creem Product id):
//   {
//     id: 'pro-monthly-creem',
//     kind: 'subscription',
//     interval: 'month',
//     monthlyCredits: 2000,
//     provider: 'creem',
//     creemProductId: {
//       test: 'prod_REPLACE_creem_test',
//       live: 'prod_REPLACE_creem_live',
//     },
//     price: 29.9,
//     currency: 'USD',
//     active: true,
//     copy: { en: { name: 'Pro', description: '...', features: ['...'] } },
//   },
//
// PayPal subscription example (needs a Billing Plan id):
//   {
//     id: 'pro-monthly-paypal',
//     kind: 'subscription',
//     interval: 'month',
//     monthlyCredits: 2000,
//     provider: 'paypal',
//     paypalPlanId: {
//       test: 'P-REPLACE_paypal_sandbox',
//       live: 'P-REPLACE_paypal_live',
//     },
//     price: 29.9,
//     currency: 'USD',
//     active: true,
//     copy: { en: { name: 'Pro', description: '...', features: ['...'] } },
//   },
//
// PayPal credit pack example (NO paypalPlanId — the one-time order is created
// dynamically from `price` at checkout):
//   {
//     id: 'pack-mini-paypal',
//     kind: 'credit_pack',
//     credits: 300,
//     provider: 'paypal',
//     price: 5.9,
//     currency: 'USD',
//     active: true,
//     copy: { en: { name: 'Mini Pack', description: '...', features: ['...'] } },
//   },
// ----------------------------------------------------------------------------

export const pricingPlans: PricingPlan[] = [
  {
    id: 'starter-monthly',
    kind: 'subscription',
    interval: 'month',
    monthlyCredits: 500,
    provider: 'stripe',
    stripePriceId: {
      test: 'price_REPLACE_starter_monthly_test',
      live: 'price_REPLACE_starter_monthly_live',
    },
    price: 9.9,
    currency: 'USD',
    active: true,
    copy: {
      en: {
        name: 'Starter',
        description:
          'For casual creators exploring AI image and video generation.',
        features: [
          '500 credits every month',
          'AI image & video generation',
          'Standard generation speed',
          'Commercial usage license',
          'Email support',
        ],
      },
      zh: {
        name: '入门版',
        description: '适合轻度使用者，探索 AI 图片与视频生成。',
        features: [
          '每月 500 积分',
          'AI 图片与视频生成',
          '标准生成速度',
          '商业使用授权',
          '邮件支持',
        ],
      },
      ja: {
        name: 'スターター',
        description: 'AI 画像・動画生成を気軽に試したいライトユーザー向け。',
        features: [
          '毎月 500 クレジット',
          'AI 画像・動画生成',
          '標準の生成速度',
          '商用利用ライセンス',
          'メールサポート',
        ],
      },
    },
  },
  {
    id: 'starter-yearly',
    kind: 'subscription',
    interval: 'year',
    monthlyCredits: 500,
    provider: 'stripe',
    stripePriceId: {
      test: 'price_REPLACE_starter_yearly_test',
      live: 'price_REPLACE_starter_yearly_live',
    },
    price: 99,
    originalPrice: 118.8,
    currency: 'USD',
    active: true,
    copy: {
      en: {
        name: 'Starter Yearly',
        description:
          'Everything in Starter, at 2 months free with annual billing.',
        features: [
          '500 credits every month',
          '2 months free vs monthly billing',
          'AI image & video generation',
          'Commercial usage license',
          'Email support',
        ],
      },
      zh: {
        name: '入门年付版',
        description: '包含入门版全部功能，按年付费立省 2 个月。',
        features: [
          '每月 500 积分',
          '相比月付立省 2 个月',
          'AI 图片与视频生成',
          '商业使用授权',
          '邮件支持',
        ],
      },
      ja: {
        name: 'スターター（年払い）',
        description: 'スターターの全機能を、年払いで 2 か月分お得に。',
        features: [
          '毎月 500 クレジット',
          '月払いより 2 か月分お得',
          'AI 画像・動画生成',
          '商用利用ライセンス',
          'メールサポート',
        ],
      },
    },
  },
  {
    id: 'pro-monthly',
    kind: 'subscription',
    interval: 'month',
    monthlyCredits: 2000,
    provider: 'stripe',
    stripePriceId: {
      test: 'price_REPLACE_pro_monthly_test',
      live: 'price_REPLACE_pro_monthly_live',
    },
    price: 29.9,
    currency: 'USD',
    popular: true,
    active: true,
    copy: {
      en: {
        name: 'Pro',
        description:
          'For serious creators who generate images and videos every day.',
        features: [
          '2,000 credits every month',
          'All AI models unlocked',
          'Priority generation queue',
          'Commercial usage license',
          'Priority support',
        ],
      },
      zh: {
        name: '专业版',
        description: '适合每天都在创作图片与视频的专业创作者。',
        features: [
          '每月 2,000 积分',
          '解锁全部 AI 模型',
          '优先生成队列',
          '商业使用授权',
          '优先客服支持',
        ],
      },
      ja: {
        name: 'プロ',
        description: '毎日画像や動画を生成する本格的なクリエイター向け。',
        features: [
          '毎月 2,000 クレジット',
          'すべての AI モデルを開放',
          '優先生成キュー',
          '商用利用ライセンス',
          '優先サポート',
        ],
      },
    },
  },
  {
    id: 'pro-yearly',
    kind: 'subscription',
    interval: 'year',
    monthlyCredits: 2000,
    provider: 'stripe',
    stripePriceId: {
      test: 'price_REPLACE_pro_yearly_test',
      live: 'price_REPLACE_pro_yearly_live',
    },
    price: 299,
    originalPrice: 358.8,
    currency: 'USD',
    popular: true,
    active: true,
    copy: {
      en: {
        name: 'Pro Yearly',
        description: 'Everything in Pro, at 2 months free with annual billing.',
        features: [
          '2,000 credits every month',
          '2 months free vs monthly billing',
          'All AI models unlocked',
          'Priority generation queue',
          'Priority support',
        ],
      },
      zh: {
        name: '专业年付版',
        description: '包含专业版全部功能，按年付费立省 2 个月。',
        features: [
          '每月 2,000 积分',
          '相比月付立省 2 个月',
          '解锁全部 AI 模型',
          '优先生成队列',
          '优先客服支持',
        ],
      },
      ja: {
        name: 'プロ（年払い）',
        description: 'プロの全機能を、年払いで 2 か月分お得に。',
        features: [
          '毎月 2,000 クレジット',
          '月払いより 2 か月分お得',
          'すべての AI モデルを開放',
          '優先生成キュー',
          '優先サポート',
        ],
      },
    },
  },
  // Team plans: seat-flat pricing — team price = personal price × seats, no
  // collaboration premium. Credits land in the organization's shared pool.
  {
    id: 'team-monthly',
    kind: 'subscription',
    interval: 'month',
    audience: 'team',
    seats: 5,
    monthlyCredits: 10000,
    provider: 'stripe',
    stripePriceId: {
      test: 'price_REPLACE_team_monthly_test',
      live: 'price_REPLACE_team_monthly_live',
    },
    price: 149.5,
    currency: 'USD',
    active: true,
    copy: {
      en: {
        name: 'Team',
        description:
          'For teams that create together — one shared pool, five seats.',
        features: [
          {
            text: '**10,000 credits** every month in a shared team pool',
            highlight: true,
          },
          {
            text: '**5 seats** included — invite your whole team',
            highlight: true,
          },
          { text: 'Per-member usage stats', highlight: true },
          'Everything in Pro, for every member',
          'One subscription, one invoice',
          'Priority support',
        ],
      },
      zh: {
        name: '团队版',
        description: '适合协同创作的团队 —— 共享积分池，5 个席位。',
        features: [
          { text: '每月 **10,000 积分**，团队共享积分池', highlight: true },
          { text: '含 **5 个席位**，邀请整个团队', highlight: true },
          { text: '成员用量统计', highlight: true },
          '每位成员均享专业版全部功能',
          '一份订阅，一张账单',
          '优先客服支持',
        ],
      },
      ja: {
        name: 'チーム',
        description: 'チームでの共同制作に。共有プールと 5 シート。',
        features: [
          {
            text: '毎月 **10,000 クレジット** をチームで共有',
            highlight: true,
          },
          { text: '**5 シート** 込み — チーム全員を招待', highlight: true },
          { text: 'メンバー別の利用状況', highlight: true },
          '全メンバーがプロの全機能を利用可能',
          'サブスクリプションも請求書も 1 つに',
          '優先サポート',
        ],
      },
    },
  },
  {
    id: 'team-yearly',
    kind: 'subscription',
    interval: 'year',
    audience: 'team',
    seats: 5,
    monthlyCredits: 10000,
    provider: 'stripe',
    stripePriceId: {
      test: 'price_REPLACE_team_yearly_test',
      live: 'price_REPLACE_team_yearly_live',
    },
    price: 1495,
    originalPrice: 1794,
    currency: 'USD',
    active: true,
    copy: {
      en: {
        name: 'Team Yearly',
        description:
          'Everything in Team, at 2 months free with annual billing.',
        features: [
          {
            text: '**10,000 credits** every month in a shared team pool',
            highlight: true,
          },
          {
            text: '**5 seats** included — invite your whole team',
            highlight: true,
          },
          '2 months free vs monthly billing',
          'Everything in Pro, for every member',
          'One subscription, one invoice',
          'Priority support',
        ],
      },
      zh: {
        name: '团队年付版',
        description: '包含团队版全部功能，按年付费立省 2 个月。',
        features: [
          { text: '每月 **10,000 积分**，团队共享积分池', highlight: true },
          { text: '含 **5 个席位**，邀请整个团队', highlight: true },
          '相比月付立省 2 个月',
          '每位成员均享专业版全部功能',
          '一份订阅，一张账单',
          '优先客服支持',
        ],
      },
      ja: {
        name: 'チーム（年払い）',
        description: 'チームの全機能を、年払いで 2 か月分お得に。',
        features: [
          {
            text: '毎月 **10,000 クレジット** をチームで共有',
            highlight: true,
          },
          { text: '**5 シート** 込み — チーム全員を招待', highlight: true },
          '月払いより 2 か月分お得',
          '全メンバーがプロの全機能を利用可能',
          'サブスクリプションも請求書も 1 つに',
          '優先サポート',
        ],
      },
    },
  },
  {
    id: 'pack-mini',
    kind: 'credit_pack',
    credits: 300,
    provider: 'stripe',
    stripePriceId: {
      test: 'price_REPLACE_pack_mini_test',
      live: 'price_REPLACE_pack_mini_live',
    },
    price: 5.9,
    currency: 'USD',
    active: true,
    copy: {
      en: {
        name: 'Mini Pack',
        description:
          'A small top-up to try things out or finish one more project.',
        features: [
          '300 credits, never expire',
          'Pay once, no subscription',
          'AI image & video generation',
          'Commercial usage license',
        ],
      },
      zh: {
        name: '迷你包',
        description: '小额补充，适合尝鲜或完成手头的最后一个项目。',
        features: [
          '300 积分，永不过期',
          '一次付费，无需订阅',
          'AI 图片与视频生成',
          '商业使用授权',
        ],
      },
      ja: {
        name: 'ミニパック',
        description: 'お試しや、あと少しの作業に最適な小さめの追加パック。',
        features: [
          '300 クレジット・無期限',
          '一度の支払いのみ、サブスク不要',
          'AI 画像・動画生成',
          '商用利用ライセンス',
        ],
      },
    },
  },
  {
    id: 'pack-standard',
    kind: 'credit_pack',
    credits: 1200,
    provider: 'stripe',
    stripePriceId: {
      test: 'price_REPLACE_pack_standard_test',
      live: 'price_REPLACE_pack_standard_live',
    },
    price: 19.9,
    currency: 'USD',
    popular: true,
    active: true,
    copy: {
      en: {
        name: 'Standard Pack',
        description: 'The best-value top-up for regular creative sessions.',
        features: [
          '1,200 credits, never expire',
          'Pay once, no subscription',
          'AI image & video generation',
          'Commercial usage license',
        ],
      },
      zh: {
        name: '标准包',
        description: '性价比最高的补充包，满足日常创作需求。',
        features: [
          '1,200 积分，永不过期',
          '一次付费，无需订阅',
          'AI 图片与视频生成',
          '商业使用授权',
        ],
      },
      ja: {
        name: 'スタンダードパック',
        description: '日常的な創作にちょうどいい、最もコスパの高いパック。',
        features: [
          '1,200 クレジット・無期限',
          '一度の支払いのみ、サブスク不要',
          'AI 画像・動画生成',
          '商用利用ライセンス',
        ],
      },
    },
  },
  {
    id: 'pack-max',
    kind: 'credit_pack',
    credits: 3500,
    provider: 'stripe',
    stripePriceId: {
      test: 'price_REPLACE_pack_max_test',
      live: 'price_REPLACE_pack_max_live',
    },
    price: 49.9,
    currency: 'USD',
    active: true,
    copy: {
      en: {
        name: 'Max Pack',
        description: 'A big batch of credits for heavy production workloads.',
        features: [
          '3,500 credits, never expire',
          'Pay once, no subscription',
          'AI image & video generation',
          'Commercial usage license',
        ],
      },
      zh: {
        name: '超值包',
        description: '大容量积分，为高强度生产任务准备。',
        features: [
          '3,500 积分，永不过期',
          '一次付费，无需订阅',
          'AI 图片与视频生成',
          '商业使用授权',
        ],
      },
      ja: {
        name: 'マックスパック',
        description: '大量生成やプロダクション用途向けの大容量パック。',
        features: [
          '3,500 クレジット・無期限',
          '一度の支払いのみ、サブスク不要',
          'AI 画像・動画生成',
          '商用利用ライセンス',
        ],
      },
    },
  },
]

// ----------------------------------------------------------------------------
// Lookups
// ----------------------------------------------------------------------------

export function isSubscriptionPlan(
  plan: PricingPlan
): plan is SubscriptionPlan {
  return plan.kind === 'subscription'
}

export const subscriptionPlans = pricingPlans.filter(isSubscriptionPlan)

/** A subscription plan sold to organizations: seats are guaranteed present. */
export interface TeamSubscriptionPlan extends SubscriptionPlan {
  audience: 'team'
  seats: number
}

/** Team plans entitle an organization (shared pool + seats). */
export function isTeamPlan(plan: PricingPlan): plan is TeamSubscriptionPlan {
  return isSubscriptionPlan(plan) && plan.audience === 'team'
}

export const personalSubscriptionPlans = subscriptionPlans.filter(
  (plan) => !isTeamPlan(plan)
)

export const teamSubscriptionPlans = subscriptionPlans.filter(isTeamPlan)

/**
 * Seat cap for an organization holding this plan. Retired slugs and non-team
 * plans collapse to 1 (owner only) — an org without a live team subscription
 * cannot invite anyone, no special case needed at the call sites.
 */
export function getPlanSeats(planId: string | null | undefined): number {
  const plan = planId ? getPlanById(planId) : undefined
  return plan && isTeamPlan(plan) ? plan.seats : 1
}

export const creditPackPlans = pricingPlans.filter(
  (plan): plan is CreditPackPlan => plan.kind === 'credit_pack'
)

export const activePricingPlans = pricingPlans.filter(
  (plan) => plan.active !== false
)

export function getPlanById(planId: string): PricingPlan | undefined {
  return pricingPlans.find((plan) => plan.id === planId)
}

/** A plan sold through Stripe: its Price reference is guaranteed present. */
export type StripePlan = PricingPlan & { stripePriceId: ProviderPriceRef }

/**
 * Stripe promotion codes can only restrict to Stripe products, so every
 * coupon tool (admin UI and server action alike) narrows the catalog with
 * this guard instead of re-checking `provider` at each call site.
 */
export function isStripePlan(plan: PricingPlan): plan is StripePlan {
  return plan.provider === 'stripe' && plan.stripePriceId !== undefined
}

/** The plan's reference field for a GIVEN provider (may differ from its own). */
function providerRefOf(
  plan: PricingPlan,
  provider: PaymentProvider
): ProviderPriceRef | undefined {
  switch (provider) {
    case 'stripe':
      return plan.stripePriceId
    case 'creem':
      return plan.creemProductId
    case 'paypal':
      return plan.paypalPlanId
  }
}

/**
 * Reverse lookup used by webhooks: provider-side id (either environment) →
 * plan. Matches the ref field that corresponds to `provider` against BOTH
 * test and live values.
 */
export function findPlanByProviderPriceId(
  provider: PaymentProvider,
  id: string
): PricingPlan | undefined {
  return pricingPlans.find((plan) => {
    const ref = providerRefOf(plan, provider)
    return ref !== undefined && (ref.test === id || ref.live === id)
  })
}

/** The provider reference for the plan's OWN checkout provider. */
export function getProviderPriceRef(
  plan: PricingPlan
): ProviderPriceRef | undefined {
  return providerRefOf(plan, plan.provider)
}

/** Credits a plan grants (per month for subscriptions, total for packs). */
export function getPlanCredits(plan: PricingPlan): number {
  return isSubscriptionPlan(plan) ? plan.monthlyCredits : plan.credits
}

/** Card copy for a locale, falling back to English for unknown locales. */
export function getPlanCopy(plan: PricingPlan, locale: string): PlanCopy {
  return plan.copy[locale] ?? plan.copy.en
}

/**
 * Localized display name for a plan id. Orders reference plans by slug
 * forever, so retired ids simply render as the slug itself.
 */
export function getPlanName(planId: string, locale: string): string {
  const plan = getPlanById(planId)
  return plan ? getPlanCopy(plan, locale).name : planId
}

/** Promotion code to auto-apply at checkout: plan-level beats campaign. */
export function getAutoPromotionCode(plan: PricingPlan): string | undefined {
  return plan.promotionCode ?? pricingCampaign.promotionCode
}
