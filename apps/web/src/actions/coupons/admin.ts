'use server';

/**
 * [INPUT]: Depends on @/lib/stripe's getStripe/isStripeEnabled/getStripePriceId/
 *          stripeMode, @/config/pricing's pricingPlans/isStripePlan/getPlanById/
 *          getAutoPromotionCode/pricingCampaign, @/lib/auth/server's isAdmin,
 *          @/lib/action-response, zod
 * [OUTPUT]: Exports getAdminPromotionCodes, createAdminPromotionCode,
 *           setPromotionCodeActive, checkPromotionCodeAvailability, and the
 *           AdminPromotionCodeItem / PromotionCodeStatus / CreatePromotionCodeInput types
 * [POS]: Sole member of actions/coupons — the read/write funnel of admin coupon
 *        management. Stripe is the only source of truth (nothing is persisted
 *        locally): one creation = Coupon (discount + product scope + billing
 *        duration) + Promotion Code (customer-facing code + redemption cap +
 *        expiry + restrictions), and a failed promo creation deletes the coupon
 *        it just made. Listing scans the whole promotion-code set once and then
 *        filters/paginates in memory, because Stripe's cursor pagination cannot
 *        express the search the dashboard needs. The customer-side consumption
 *        path lives in actions/billing/checkout (auto-applied campaign codes +
 *        the manual promo input); this file never touches checkout.
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */

import {
  activePricingPlans,
  getAutoPromotionCode,
  getPlanById,
  isStripePlan,
  pricingCampaign,
  pricingPlans,
  type StripePlan,
} from '@/config/pricing';
import { actionResponse, type ActionResult } from '@/lib/action-response';
import { isAdmin } from '@/lib/auth/server';
import {
  getStripe,
  getStripePriceId,
  isStripeEnabled,
  stripeMode,
} from '@/lib/stripe';
import Stripe from 'stripe';
import { z } from 'zod';

// ============================================================================
//  Tunables
// ============================================================================

/** Upper bound of promotion codes pulled from Stripe per listing request. */
const MAX_SCANNED_CODES = 500

/** Price → product resolution is effectively static; re-resolve every 10 min. */
const PRODUCT_MAP_TTL_MS = 10 * 60 * 1000

/** Codes are matched case-insensitively by Stripe; we normalize to upper case. */
const CODE_PATTERN = /^[A-Z0-9_-]{3,30}$/

// ============================================================================
//  DTO — server action results must be serializable, so Stripe objects are
//  flattened here and every derived flag the table needs is computed server side
// ============================================================================

/**
 * Lifecycle of a code as an operator sees it. `expired` and `exhausted` are
 * terminal (Stripe refuses to re-enable them), which is exactly why they are
 * separate values instead of a single "inactive" — the row's toggle reads its
 * disabled state straight off the status.
 */
export type PromotionCodeStatus = 'active' | 'disabled' | 'expired' | 'exhausted'

export interface AdminPromotionCodeItem {
  /** Promotion code id (promo_…), the target of enable/disable */
  id: string
  /** What the customer types at checkout, e.g. LAUNCH20 */
  code: string
  active: boolean
  status: PromotionCodeStatus
  /** Coupon display name, shown in the Stripe dashboard and on invoices */
  name: string | null
  percentOff: number | null
  /** Integer cents (Stripe's native unit); mutually exclusive with percentOff */
  amountOff: number | null
  currency: string | null
  duration: 'once' | 'repeating' | 'forever'
  durationInMonths: number | null
  /** Plan ids the code is limited to; empty = every product */
  appliesToPlanIds: string[]
  /** Products with no plan behind them (created straight in the Stripe dashboard) */
  appliesToUnknownProducts: string[]
  timesRedeemed: number
  maxRedemptions: number | null
  /** epoch seconds; null = never expires */
  expiresAt: number | null
  createdAt: number
  /** Restricted to customers with no prior payment */
  firstTimeOnly: boolean
  /** Minimum order amount in integer cents; null = no minimum */
  minimumAmount: number | null
  /**
   * True when config/pricing auto-applies this code at checkout (campaign-wide
   * or plan-level). Such codes are live for every visitor, so disabling one
   * silently drops the discount instead of showing an error.
   */
  autoApplied: boolean
  /** Deep link into the Stripe dashboard, mode-aware */
  dashboardUrl: string
}

/** Which products a listing is restricted to. Absent = no restriction filter. */
export type AppliesToFilter =
  | { kind: 'plan'; planId: string }
  | { kind: 'unrestricted' }

// ============================================================================
//  Input schemas — the discount pair and the repeating duration are cross-field
//  rules, so they are collapsed into one superRefine instead of branchy checks
// ============================================================================

const CreateInputSchema = z
  .object({
    /** Custom code; empty lets Stripe generate one */
    code: z.string().trim().toUpperCase().regex(CODE_PATTERN).optional(),
    /** Coupon display name, surfaced in the Stripe dashboard and on invoices */
    name: z.string().trim().min(1).max(40).optional(),
    discountType: z.enum(['percent', 'amount']),
    percentOff: z.number().gt(0).max(100).optional(),
    amountOffCents: z.number().int().positive().optional(),
    /** Restrict to these plans; empty = every product */
    planIds: z.array(z.string().trim().min(1)).max(20).optional(),
    duration: z.enum(['once', 'repeating', 'forever']),
    durationInMonths: z.number().int().min(1).max(36).optional(),
    maxRedemptions: z.number().int().min(1).optional(),
    /** epoch seconds, must be in the future */
    expiresAt: z.number().int().positive().optional(),
    /** Only customers who never paid before may redeem */
    firstTimeOnly: z.boolean().optional(),
    /** Minimum order amount in integer cents */
    minimumAmountCents: z.number().int().positive().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.discountType === 'percent' && value.percentOff === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'percentOff is required.' })
    }
    if (value.discountType === 'amount' && value.amountOffCents === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'amountOffCents is required.' })
    }
    if (value.duration === 'repeating' && value.durationInMonths === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'durationInMonths is required.' })
    }
    if (value.expiresAt !== undefined && value.expiresAt <= nowInSeconds()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'expiresAt must be in the future.' })
    }
  })

export type CreatePromotionCodeInput = z.input<typeof CreateInputSchema>

// ============================================================================
//  Stripe plumbing
// ============================================================================

function nowInSeconds(): number {
  return Math.floor(Date.now() / 1000)
}

/** Admin-only surface: Stripe's own message is the most actionable text there is. */
function stripeMessage(error: unknown, fallback: string): string {
  return error instanceof Stripe.errors.StripeError && error.message
    ? error.message
    : fallback
}

function dashboardUrl(promotionCodeId: string): string {
  const modePath = stripeMode === 'live' ? '' : 'test/'
  return `https://dashboard.stripe.com/${modePath}promotion_codes/${promotionCodeId}`
}

/**
 * Codes that config/pricing auto-applies at checkout (campaign-wide or
 * plan-level), upper-cased for comparison against Stripe's stored codes.
 */
function autoAppliedCodes(): Set<string> {
  const codes = pricingPlans
    .map((plan) => getAutoPromotionCode(plan))
    .concat(pricingCampaign.promotionCode)
    .filter((code): code is string => Boolean(code))
  return new Set(codes.map((code) => code.toUpperCase()))
}

// ── product id ↔ plan id ─────────────────────────────────────────────────────
// config/pricing stores Price ids only; the Product id behind each Price is
// resolved through the API and cached, so listing costs one Stripe call in the
// steady state instead of one per plan.

let productPlanCache: { map: Map<string, string>; expiresAt: number } | null = null

async function getProductPlanMap(): Promise<Map<string, string>> {
  if (productPlanCache && productPlanCache.expiresAt > Date.now()) {
    return productPlanCache.map
  }

  const stripe = getStripe()
  const entries = await Promise.all(
    // Retired plans still need reverse mapping: their old codes remain listed.
    pricingPlans.filter(isStripePlan).map(async (plan) => {
      try {
        const price = await stripe.prices.retrieve(getStripePriceId(plan))
        return [productIdOf(price), plan.id] as const
      } catch {
        // A Price belonging to the other mode is invisible to this key — skip it.
        return null
      }
    })
  )

  const map = new Map(
    entries.filter((entry): entry is readonly [string, string] => entry !== null)
  )
  productPlanCache = { map, expiresAt: Date.now() + PRODUCT_MAP_TTL_MS }
  return map
}

function productIdOf(price: Stripe.Price): string {
  return typeof price.product === 'string' ? price.product : price.product.id
}

/** Resolves the Stripe Product ids the coupon should be restricted to. */
async function resolvePlanProducts(plans: StripePlan[]): Promise<string[]> {
  const stripe = getStripe()
  const prices = await Promise.all(
    plans.map((plan) => stripe.prices.retrieve(getStripePriceId(plan)))
  )
  return Array.from(new Set(prices.map(productIdOf)))
}

/**
 * Currency for a fixed-amount discount. Restricted coupons follow their plans;
 * an unrestricted one follows the catalog. Mixed currencies have no single
 * right answer, so the caller is asked to narrow the scope instead.
 */
function resolveCurrency(plans: StripePlan[]): string | null {
  const scope = plans.length > 0 ? plans : activePricingPlans.filter(isStripePlan)
  const currencies = new Set(scope.map((plan) => plan.currency.toLowerCase()))
  if (currencies.size === 0) return 'usd'
  if (currencies.size > 1) return null
  return currencies.values().next().value ?? 'usd'
}

// ============================================================================
//  Mapping
// ============================================================================

function deriveStatus(promo: Stripe.PromotionCode): PromotionCodeStatus {
  // Terminal states first: both are irreversible, and an exhausted code that is
  // also past its expiry is best described by the cap the operator set.
  if (promo.max_redemptions != null && promo.times_redeemed >= promo.max_redemptions) {
    return 'exhausted'
  }
  if (promo.expires_at != null && promo.expires_at <= nowInSeconds()) return 'expired'
  if (!promo.coupon.valid) return 'expired'
  return promo.active ? 'active' : 'disabled'
}

function toItem(
  promo: Stripe.PromotionCode,
  productPlanMap: Map<string, string>,
  autoCodes: Set<string>
): AdminPromotionCodeItem {
  const coupon = promo.coupon
  const products = coupon.applies_to?.products ?? []
  const planIds: string[] = []
  const unknownProducts: string[] = []
  for (const product of products) {
    const planId = productPlanMap.get(product)
    if (planId) planIds.push(planId)
    else unknownProducts.push(product)
  }

  return {
    id: promo.id,
    code: promo.code,
    active: promo.active,
    status: deriveStatus(promo),
    name: coupon.name ?? null,
    percentOff: coupon.percent_off ?? null,
    amountOff: coupon.amount_off ?? null,
    currency: coupon.currency ?? null,
    duration: coupon.duration,
    durationInMonths: coupon.duration_in_months ?? null,
    appliesToPlanIds: planIds,
    appliesToUnknownProducts: unknownProducts,
    timesRedeemed: promo.times_redeemed,
    maxRedemptions: promo.max_redemptions ?? null,
    expiresAt: promo.expires_at ?? null,
    createdAt: promo.created,
    firstTimeOnly: promo.restrictions?.first_time_transaction ?? false,
    minimumAmount: promo.restrictions?.minimum_amount ?? null,
    autoApplied: autoCodes.has(promo.code.toUpperCase()),
    dashboardUrl: dashboardUrl(promo.id),
  }
}

function matchesFilters(
  item: AdminPromotionCodeItem,
  filters: {
    search: string
    status?: PromotionCodeStatus
    appliesTo?: AppliesToFilter
  }
): boolean {
  if (filters.status && item.status !== filters.status) return false

  if (filters.appliesTo) {
    const restricted =
      item.appliesToPlanIds.length > 0 || item.appliesToUnknownProducts.length > 0
    if (filters.appliesTo.kind === 'unrestricted') {
      if (restricted) return false
    } else if (!item.appliesToPlanIds.includes(filters.appliesTo.planId)) {
      return false
    }
  }

  if (filters.search) {
    const haystack = `${item.code} ${item.name ?? ''}`.toLowerCase()
    if (!haystack.includes(filters.search)) return false
  }

  return true
}

// ============================================================================
//  Actions
// ============================================================================

/**
 * Filtered, paginated promotion codes. Stripe only offers cursor pagination and
 * no text search, so the whole set (capped at MAX_SCANNED_CODES) is pulled once
 * and narrowed here — the operator gets search, status and product filters that
 * the API itself cannot express.
 */
export async function getAdminPromotionCodes(params: {
  pageIndex: number
  pageSize: number
  /** Case-insensitive substring of the code or the coupon name */
  search?: string
  status?: PromotionCodeStatus
  appliesTo?: AppliesToFilter
}): Promise<
  ActionResult<{
    items: AdminPromotionCodeItem[]
    total: number
    /** Codes held by Stripe before filtering — the "0 of 42" denominator */
    scanned: number
    /** True when the scan hit MAX_SCANNED_CODES and older codes were dropped */
    truncated: boolean
  }>
> {
  if (!(await isAdmin())) return actionResponse.forbidden()
  if (!isStripeEnabled) {
    return actionResponse.error('Stripe is not configured — coupons are unavailable.')
  }

  try {
    const [promos, productPlanMap] = await Promise.all([
      getStripe()
        .promotionCodes.list({ limit: 100, expand: ['data.coupon.applies_to'] })
        .autoPagingToArray({ limit: MAX_SCANNED_CODES }),
      getProductPlanMap(),
    ])

    const autoCodes = autoAppliedCodes()
    const normalized = {
      search: (params.search ?? '').trim().toLowerCase(),
      status: params.status,
      appliesTo: params.appliesTo,
    }
    // Stripe returns newest first; that order is what an operator expects after
    // creating a code, so it is preserved rather than re-sorted.
    const matched = promos
      .map((promo) => toItem(promo, productPlanMap, autoCodes))
      .filter((item) => matchesFilters(item, normalized))

    const start = params.pageIndex * params.pageSize
    return actionResponse.success({
      items: matched.slice(start, start + params.pageSize),
      total: matched.length,
      scanned: promos.length,
      truncated: promos.length >= MAX_SCANNED_CODES,
    })
  } catch (error) {
    console.error('getAdminPromotionCodes failed:', error)
    return actionResponse.error(
      stripeMessage(error, 'Failed to load promotion codes from Stripe.')
    )
  }
}

/**
 * Tells whether a code is still free, so the form can say so before submitting
 * instead of turning a duplicate into a failed creation.
 */
export async function checkPromotionCodeAvailability(
  code: string
): Promise<ActionResult<{ available: boolean }>> {
  if (!(await isAdmin())) return actionResponse.forbidden()
  if (!isStripeEnabled) {
    return actionResponse.error('Stripe is not configured — coupons are unavailable.')
  }

  const normalized = code.trim().toUpperCase()
  if (!CODE_PATTERN.test(normalized)) {
    return actionResponse.badRequest('Invalid code format.')
  }

  try {
    const { data } = await getStripe().promotionCodes.list({
      code: normalized,
      limit: 1,
    })
    return actionResponse.success({ available: data.length === 0 })
  } catch (error) {
    console.error('checkPromotionCodeAvailability failed:', error)
    return actionResponse.error(stripeMessage(error, 'Failed to check the code.'))
  }
}

/**
 * Creates a Coupon plus its Promotion Code in one shot. Discount, billing
 * duration and product scope belong to the coupon; the customer-facing code,
 * redemption cap, expiry and restrictions belong to the promotion code — the
 * split follows Stripe's own semantics. If the promo step fails (a duplicate
 * code being the usual cause) the freshly created coupon is deleted, so a
 * rejected form never leaves an orphan behind.
 */
export async function createAdminPromotionCode(
  input: CreatePromotionCodeInput
): Promise<ActionResult<AdminPromotionCodeItem>> {
  if (!(await isAdmin())) return actionResponse.forbidden()
  if (!isStripeEnabled) {
    return actionResponse.error('Stripe is not configured — coupons are unavailable.')
  }

  const parsed = CreateInputSchema.safeParse(input)
  if (!parsed.success) {
    return actionResponse.badRequest(
      parsed.error.issues[0]?.message ?? 'Invalid coupon data.'
    )
  }
  const data = parsed.data

  // ── Scope: plan ids → Stripe product ids ──
  const plans: StripePlan[] = []
  for (const planId of data.planIds ?? []) {
    const plan = getPlanById(planId)
    if (!plan || !isStripePlan(plan)) {
      return actionResponse.badRequest(`Plan "${planId}" is not sold through Stripe.`)
    }
    plans.push(plan)
  }

  let products: string[] = []
  if (plans.length > 0) {
    try {
      products = await resolvePlanProducts(plans)
    } catch (error) {
      console.error('resolvePlanProducts failed:', error)
      return actionResponse.error(
        stripeMessage(
          error,
          'Failed to resolve the Stripe products for these plans (check test/live mode).'
        )
      )
    }
  }

  // ── Currency: only needed by fixed-amount discounts and order minimums ──
  const needsCurrency =
    data.discountType === 'amount' || data.minimumAmountCents !== undefined
  const currency = needsCurrency ? resolveCurrency(plans) : null
  if (needsCurrency && !currency) {
    return actionResponse.badRequest(
      'Plans use mixed currencies — restrict the coupon to plans sharing one currency, or use a percentage discount.'
    )
  }

  const stripe = getStripe()
  let coupon: Stripe.Coupon
  try {
    coupon = await stripe.coupons.create({
      ...(data.name ? { name: data.name } : {}),
      duration: data.duration,
      ...(data.duration === 'repeating'
        ? { duration_in_months: data.durationInMonths }
        : {}),
      ...(data.discountType === 'percent'
        ? { percent_off: data.percentOff }
        : { amount_off: data.amountOffCents, currency: currency! }),
      ...(products.length > 0 ? { applies_to: { products } } : {}),
    })
  } catch (error) {
    console.error('coupons.create failed:', error)
    return actionResponse.error(
      stripeMessage(error, 'Stripe rejected the coupon. Check the discount values.')
    )
  }

  try {
    const promo = await stripe.promotionCodes.create({
      coupon: coupon.id,
      ...(data.code ? { code: data.code } : {}),
      ...(data.maxRedemptions ? { max_redemptions: data.maxRedemptions } : {}),
      ...(data.expiresAt ? { expires_at: data.expiresAt } : {}),
      ...(data.firstTimeOnly || data.minimumAmountCents !== undefined
        ? {
            restrictions: {
              ...(data.firstTimeOnly ? { first_time_transaction: true } : {}),
              ...(data.minimumAmountCents !== undefined
                ? {
                    minimum_amount: data.minimumAmountCents,
                    minimum_amount_currency: currency!,
                  }
                : {}),
            },
          }
        : {}),
      expand: ['coupon.applies_to'],
    })
    return actionResponse.success(
      toItem(promo, await getProductPlanMap(), autoAppliedCodes())
    )
  } catch (error) {
    // Never leave an orphan coupon; a failed cleanup is only logged since the
    // Stripe dashboard can still remove it.
    await stripe.coupons.del(coupon.id).catch((cleanupError) => {
      console.error('coupon cleanup failed:', cleanupError)
    })
    console.error('promotionCodes.create failed:', error)
    return actionResponse.error(
      stripeMessage(error, 'Stripe rejected the promotion code.')
    )
  }
}

/**
 * Enables or disables a promotion code. Stripe keeps codes forever (they are
 * referenced by past invoices), so disabling is the only "delete" there is;
 * codes that expired or ran out of redemptions cannot be brought back.
 */
export async function setPromotionCodeActive(params: {
  id: string
  active: boolean
}): Promise<ActionResult> {
  if (!(await isAdmin())) return actionResponse.forbidden()
  if (!isStripeEnabled) {
    return actionResponse.error('Stripe is not configured — coupons are unavailable.')
  }

  const parsed = z
    .object({ id: z.string().startsWith('promo_'), active: z.boolean() })
    .safeParse(params)
  if (!parsed.success) return actionResponse.badRequest('Invalid promotion code id.')

  try {
    await getStripe().promotionCodes.update(parsed.data.id, {
      active: parsed.data.active,
    })
    return actionResponse.success()
  } catch (error) {
    console.error('setPromotionCodeActive failed:', error)
    return actionResponse.error(
      stripeMessage(error, 'Failed to update the promotion code.')
    )
  }
}
