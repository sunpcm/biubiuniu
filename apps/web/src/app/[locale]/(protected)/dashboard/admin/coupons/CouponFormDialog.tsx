/**
 * [INPUT]: Depends on @/actions/coupons/admin's createAdminPromotionCode /
 *          checkPromotionCodeAvailability, ./schemas' createCouponFormSchema /
 *          toCreateInput / generateCode / EXPIRY_PRESETS / presetToValue,
 *          @/config/pricing's activePricingPlans/isStripePlan/getPlanCopy,
 *          @/lib/format's formatCurrency, shadcn Dialog/Form/Popover/Command/
 *          ToggleGroup/Switch, react-hook-form + zodResolver
 * [OUTPUT]: Exports the CouponFormDialog component (create / duplicate a coupon)
 * [POS]: The creation surface of admin/coupons, opened by DataTable for both a
 *        blank form and a duplicate. Three things make it more than a form: the
 *        code is checked against Stripe while you type, conditional fields
 *        (months, discount value) appear only when they mean something, and a
 *        live summary states in one sentence what the customer will actually
 *        get — nothing here is submitted blind.
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */

"use client";

import {
  checkPromotionCodeAvailability,
  createAdminPromotionCode,
} from "@/actions/coupons/admin";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  activePricingPlans,
  getPlanCopy,
  isStripePlan,
  type StripePlan,
} from "@/config/pricing";
import { formatCurrency, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Check,
  ChevronsUpDown,
  CircleAlert,
  CircleCheck,
  Loader2,
  Shuffle,
  X,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import {
  CODE_PATTERN,
  createCouponFormSchema,
  EMPTY_COUPON_FORM,
  EXPIRY_PRESETS,
  generateCode,
  presetToValue,
  toCreateInput,
  type CouponFormValues,
} from "./schemas";

/** Quick picks for the most common launch discounts. */
const PERCENT_SHORTCUTS = [10, 20, 30, 50];

/** Availability of the typed code, as far as Stripe has told us so far. */
type CodeAvailability = "idle" | "checking" | "available" | "taken";

interface CouponFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Prefilled values for "duplicate"; null opens a blank form */
  initialValues: CouponFormValues | null;
  /** Called once the coupon is live in Stripe — refresh the table */
  onCreated: () => void;
}

export function CouponFormDialog({
  open,
  onOpenChange,
  initialValues,
  onCreated,
}: CouponFormDialogProps) {
  const t = useTranslations("Coupons");
  const tForm = useTranslations("Coupons.form");
  const tSummary = useTranslations("Coupons.summary");
  const tErrors = useTranslations("Coupons.formErrors");
  const locale = useLocale();

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [availability, setAvailability] = useState<CodeAvailability>("idle");
  const [planPickerOpen, setPlanPickerOpen] = useState(false);
  /** Which expiry chip is lit; "custom" swaps in the datetime input */
  const [expiryChoice, setExpiryChoice] = useState<string>("never");

  const schema = useMemo(() => createCouponFormSchema(tErrors), [tErrors]);
  const form = useForm<CouponFormValues>({
    resolver: zodResolver(schema),
    defaultValues: EMPTY_COUPON_FORM,
    mode: "onTouched",
  });

  // Only plans sold through Stripe can carry a Stripe coupon.
  const stripePlans = useMemo(
    () => activePricingPlans.filter(isStripePlan),
    []
  );

  const values = form.watch();
  const selectedPlans = useMemo(
    () => stripePlans.filter((plan) => values.planIds.includes(plan.id)),
    [stripePlans, values.planIds]
  );

  /**
   * Fixed amounts need a currency. The scope decides it: selected plans first,
   * the catalog otherwise — same rule the server applies when creating.
   */
  const currency = (
    selectedPlans[0]?.currency ??
    stripePlans[0]?.currency ??
    "USD"
  ).toUpperCase();

  /**
   * A credit pack is charged once, so Stripe's billing duration has nothing to
   * repeat over. Rather than let an operator pick a setting that silently does
   * nothing, the field locks itself to "once".
   */
  const oneTimeOnly =
    selectedPlans.length > 0 &&
    selectedPlans.every((plan) => plan.kind === "credit_pack");

  /** Rendered by hand under the duration row — see the note at its call site. */
  const monthsError = form.formState.errors.durationInMonths?.message;

  // ── Reset on every open: a dialog that remembers the last attempt lies ──
  useEffect(() => {
    if (!open) return;
    const next = initialValues ?? EMPTY_COUPON_FORM;
    form.reset(next);
    setAvailability("idle");
    setExpiryChoice(next.expiresAt ? "custom" : "never");
  }, [open, initialValues, form]);

  useEffect(() => {
    if (oneTimeOnly && form.getValues("duration") !== "once") {
      form.setValue("duration", "once");
    }
  }, [oneTimeOnly, form]);

  // ── Live code availability: a duplicate should surface here, not on submit ──
  useEffect(() => {
    const candidate = values.code.trim().toUpperCase();
    if (!CODE_PATTERN.test(candidate)) {
      setAvailability("idle");
      return;
    }

    setAvailability("checking");
    let cancelled = false;
    const timer = setTimeout(async () => {
      const result = await checkPromotionCodeAvailability(candidate);
      if (cancelled) return;
      // A failed check must not block creation — Stripe stays the referee.
      setAvailability(
        result.success && result.data
          ? result.data.available
            ? "available"
            : "taken"
          : "idle"
      );
    }, 500);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [values.code]);

  const togglePlan = (planId: string) => {
    const current = form.getValues("planIds");
    form.setValue(
      "planIds",
      current.includes(planId)
        ? current.filter((id) => id !== planId)
        : [...current, planId],
      { shouldDirty: true }
    );
  };

  const chooseExpiry = (key: string, days: number | null) => {
    setExpiryChoice(key);
    form.setValue("expiresAt", presetToValue(days), { shouldValidate: true });
  };

  const chooseCustomExpiry = () => {
    setExpiryChoice("custom");
    if (!form.getValues("expiresAt")) {
      form.setValue("expiresAt", presetToValue(30), { shouldValidate: true });
    }
  };

  const onSubmit = async (submitted: CouponFormValues) => {
    setIsSubmitting(true);
    try {
      const result = await createAdminPromotionCode(toCreateInput(submitted));
      if (!result.success) {
        toast.error(t("toasts.createFailed"), { description: result.error });
        return;
      }
      toast.success(t("toasts.created", { code: result.data?.code ?? "" }));
      onOpenChange(false);
      onCreated();
    } finally {
      setIsSubmitting(false);
    }
  };

  const planLabel = (plan: StripePlan) => getPlanCopy(plan, locale).name;

  // ── Live summary: the form restated as the sentence a customer would hear ──
  //    form.watch() returns a fresh object on every render, so memoizing this
  //    would cache nothing; the whole computation is a handful of comparisons.
  const summary = (() => {
    const percent = Number(values.percentOff);
    const amount = Number(values.amountOff);
    const hasDiscount =
      values.discountType === "percent"
        ? values.percentOff.trim() !== "" && percent > 0 && percent <= 100
        : values.amountOff.trim() !== "" && amount > 0;

    const discount = !hasDiscount
      ? tSummary("discountPending")
      : values.discountType === "percent"
        ? t("discountValue.percent", { value: percent })
        : t("discountValue.amount", {
            value: formatCurrency(amount, currency, locale),
          });

    const chips = [
      values.duration === "repeating"
        ? t("durationValue.repeating", {
            months: Number(values.durationInMonths) || 0,
          })
        : t(`durationValue.${values.duration}`),
      values.maxRedemptions.trim() === ""
        ? tSummary("redemptionsUnlimited")
        : tSummary("redemptionsLimited", {
            count: Number(values.maxRedemptions) || 0,
          }),
      // A half-typed datetime-local value parses to NaN; Intl throws on that,
      // so an unfinished expiry simply reads as "no expiry" until it is valid.
      Number.isNaN(Date.parse(values.expiresAt))
        ? tSummary("expiryNever")
        : tSummary("expiryUntil", {
            date: formatDate(Date.parse(values.expiresAt), locale, {
              dateStyle: "medium",
              timeStyle: "short",
            }),
          }),
    ];
    if (values.firstTimeOnly) chips.push(tSummary("firstTimeOnly"));
    if (values.minimumAmount.trim() !== "") {
      chips.push(
        tSummary("minimum", {
          amount: formatCurrency(
            Number(values.minimumAmount) || 0,
            currency,
            locale
          ),
        })
      );
    }

    return {
      headline: tSummary("headline", {
        code: values.code.trim()
          ? values.code.trim().toUpperCase()
          : tSummary("autoCode"),
        discount,
        scope:
          selectedPlans.length > 0
            ? selectedPlans.map(planLabel).join(", ")
            : tSummary("scopeAll"),
      }),
      chips,
    };
  })();

  const codeStatus: Record<CodeAvailability, ReactNode> = {
    idle: null,
    checking: (
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        {tForm("codeChecking")}
      </span>
    ),
    available: (
      <span className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
        <CircleCheck className="h-3 w-3" />
        {tForm("codeAvailable")}
      </span>
    ),
    taken: (
      <span className="flex items-center gap-1 text-xs text-destructive">
        <CircleAlert className="h-3 w-3" />
        {tForm("codeTaken")}
      </span>
    ),
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {initialValues ? tForm("duplicateTitle") : tForm("title")}
          </DialogTitle>
          <DialogDescription>
            {initialValues
              ? tForm("duplicateDescription")
              : tForm("description")}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            {/* ── Identity: the code itself and its internal name ── */}
            <div className="grid gap-4 sm:grid-cols-2 items-start">
              <FormField
                control={form.control}
                name="code"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tForm("code")}</FormLabel>
                    <div className="flex gap-2">
                      <FormControl>
                        <Input
                          {...field}
                          className="font-mono"
                          placeholder={tForm("codePlaceholder")}
                          onChange={(event) =>
                            field.onChange(event.target.value.toUpperCase())
                          }
                        />
                      </FormControl>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        title={tForm("generate")}
                        onClick={() =>
                          form.setValue("code", generateCode(), {
                            shouldValidate: true,
                          })
                        }
                      >
                        <Shuffle className="h-4 w-4" />
                      </Button>
                    </div>
                    {codeStatus[availability]}
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tForm("name")}</FormLabel>
                    <FormControl>
                      <Input placeholder={tForm("namePlaceholder")} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* ── Discount: type switch plus the value that type implies ── */}
            <div className="grid gap-4 sm:grid-cols-2 items-start">
              <FormField
                control={form.control}
                name="discountType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tForm("discountType")}</FormLabel>
                    <FormControl>
                      <ToggleGroup
                        type="single"
                        variant="outline"
                        value={field.value}
                        // Radix reports "" when the active item is clicked again;
                        // a discount type is never absent, so that is ignored.
                        onValueChange={(value) => value && field.onChange(value)}
                        className="w-full"
                      >
                        <ToggleGroupItem value="percent" className="flex-1">
                          {tForm("percent")}
                        </ToggleGroupItem>
                        <ToggleGroupItem value="amount" className="flex-1">
                          {tForm("amount")}
                        </ToggleGroupItem>
                      </ToggleGroup>
                    </FormControl>
                  </FormItem>
                )}
              />

              {values.discountType === "percent" ? (
                <FormField
                  control={form.control}
                  name="percentOff"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{tForm("percentValue")}</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min={1}
                          max={100}
                          step="any"
                          placeholder="20"
                          {...field}
                        />
                      </FormControl>
                      <div className="flex gap-1.5">
                        {PERCENT_SHORTCUTS.map((percent) => (
                          <Button
                            key={percent}
                            type="button"
                            size="sm"
                            variant={
                              Number(field.value) === percent
                                ? "secondary"
                                : "outline"
                            }
                            className="h-6 rounded-full px-2.5 text-xs font-normal"
                            onClick={() =>
                              form.setValue("percentOff", String(percent), {
                                shouldValidate: true,
                              })
                            }
                          >
                            {percent}%
                          </Button>
                        ))}
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              ) : (
                <FormField
                  control={form.control}
                  name="amountOff"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        {tForm("amountValue", { currency })}
                      </FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min={0}
                          step="0.01"
                          placeholder="10.00"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
            </div>

            {/* ── Scope and billing duration ── */}
            <div className="grid gap-4 sm:grid-cols-2 items-start">
              <FormField
                control={form.control}
                name="planIds"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tForm("appliesTo")}</FormLabel>
                    <Popover open={planPickerOpen} onOpenChange={setPlanPickerOpen}>
                      <PopoverTrigger asChild>
                        <FormControl>
                          <Button
                            type="button"
                            variant="outline"
                            role="combobox"
                            disabled={stripePlans.length === 0}
                            className="w-full justify-between font-normal"
                          >
                            {field.value.length === 0
                              ? tForm("allProducts")
                              : tForm("plansSelected", {
                                  count: field.value.length,
                                })}
                            <ChevronsUpDown className="h-4 w-4 opacity-50" />
                          </Button>
                        </FormControl>
                      </PopoverTrigger>
                      <PopoverContent
                        className="w-[var(--radix-popover-trigger-width)] p-0"
                        align="start"
                      >
                        <Command>
                          <CommandInput
                            placeholder={tForm("planSearchPlaceholder")}
                          />
                          <CommandList>
                            <CommandEmpty>{tForm("planNoResults")}</CommandEmpty>
                            <CommandGroup>
                              <CommandItem
                                value="__all__"
                                onSelect={() => form.setValue("planIds", [])}
                              >
                                <Check
                                  className={cn(
                                    "h-4 w-4",
                                    field.value.length === 0
                                      ? "opacity-100"
                                      : "opacity-0"
                                  )}
                                />
                                {tForm("allProducts")}
                              </CommandItem>
                              {stripePlans.map((plan) => (
                                <CommandItem
                                  key={plan.id}
                                  value={`${planLabel(plan)} ${plan.id}`}
                                  onSelect={() => togglePlan(plan.id)}
                                >
                                  <Check
                                    className={cn(
                                      "h-4 w-4",
                                      field.value.includes(plan.id)
                                        ? "opacity-100"
                                        : "opacity-0"
                                    )}
                                  />
                                  <span className="truncate">
                                    {planLabel(plan)}
                                  </span>
                                  <span className="ml-auto text-xs text-muted-foreground">
                                    {formatCurrency(
                                      plan.price,
                                      plan.currency,
                                      locale
                                    )}
                                  </span>
                                </CommandItem>
                              ))}
                            </CommandGroup>
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>

                    {/* Selected plans stay visible and removable without reopening */}
                    {selectedPlans.length > 0 && (
                      <div className="flex flex-wrap gap-1 pt-1">
                        {selectedPlans.map((plan) => (
                          <Badge
                            key={plan.id}
                            variant="secondary"
                            className="gap-1 font-normal"
                          >
                            {planLabel(plan)}
                            <button
                              type="button"
                              onClick={() => togglePlan(plan.id)}
                              className="text-muted-foreground hover:text-foreground"
                              aria-label={planLabel(plan)}
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </Badge>
                        ))}
                      </div>
                    )}
                    {stripePlans.length === 0 && (
                      <FormDescription>{tForm("noStripePlans")}</FormDescription>
                    )}
                  </FormItem>
                )}
              />

              {/* The month count only qualifies the duration — same decision, same cell */}
              <FormField
                control={form.control}
                name="duration"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tForm("duration")}</FormLabel>
                    <div className="flex items-center gap-2">
                      <Select
                        value={field.value}
                        onValueChange={field.onChange}
                        disabled={oneTimeOnly}
                      >
                        <FormControl>
                          <SelectTrigger className="flex-1">
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="once">
                            {tForm("durationOption.once")}
                          </SelectItem>
                          <SelectItem value="repeating">
                            {tForm("durationOption.repeating")}
                          </SelectItem>
                          <SelectItem value="forever">
                            {tForm("durationOption.forever")}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                      {values.duration === "repeating" && (
                        <FormField
                          control={form.control}
                          name="durationInMonths"
                          render={({ field: months }) => (
                            <FormItem className="w-28 shrink-0">
                              <FormControl>
                                <Input
                                  type="number"
                                  min={1}
                                  max={36}
                                  placeholder={tForm("durationInMonths")}
                                  {...months}
                                />
                              </FormControl>
                            </FormItem>
                          )}
                        />
                      )}
                    </div>
                    {/* Full width, not beside the narrow input where the
                        sentence would wrap to four lines */}
                    {monthsError && (
                      <p className="text-destructive text-sm">{monthsError}</p>
                    )}
                    {oneTimeOnly && (
                      <FormDescription>
                        {tForm("durationDisabledHint")}
                      </FormDescription>
                    )}
                  </FormItem>
                )}
              />
            </div>

            {/* ── Limits: how many, how big, and who ── */}
            <div className="grid gap-4 sm:grid-cols-2 items-start">
              <FormField
                control={form.control}
                name="maxRedemptions"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tForm("maxRedemptions")}</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={1}
                        placeholder={tForm("maxRedemptionsPlaceholder")}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="minimumAmount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tForm("minimumAmount", { currency })}</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        placeholder={tForm("minimumAmountPlaceholder")}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="firstTimeOnly"
              render={({ field }) => (
                <FormItem className="flex items-center justify-between rounded-md border p-2.5">
                  <div className="pr-4">
                    <FormLabel>{tForm("firstTimeOnly")}</FormLabel>
                    <FormDescription className="text-xs">
                      {tForm("firstTimeOnlyHint")}
                    </FormDescription>
                  </div>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                </FormItem>
              )}
            />

            {/* ── Expiry: presets first, the raw picker only when asked for ── */}
            <FormField
              control={form.control}
              name="expiresAt"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{tForm("expiresAt")}</FormLabel>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {EXPIRY_PRESETS.map((preset) => (
                      <Button
                        key={preset.key}
                        type="button"
                        size="sm"
                        variant={
                          expiryChoice === preset.key ? "secondary" : "outline"
                        }
                        className="h-8"
                        onClick={() => chooseExpiry(preset.key, preset.days)}
                      >
                        {tForm(`expiryPreset.${preset.key}`)}
                      </Button>
                    ))}
                    <Button
                      type="button"
                      size="sm"
                      variant={
                        expiryChoice === "custom" ? "secondary" : "outline"
                      }
                      className="h-8"
                      onClick={chooseCustomExpiry}
                    >
                      {tForm("expiryCustom")}
                    </Button>
                  </div>
                  {expiryChoice === "custom" && (
                    <FormControl>
                      <Input type="datetime-local" className="mt-2" {...field} />
                    </FormControl>
                  )}
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* ── The whole form, restated as one sentence ── */}
            <div className="rounded-md border bg-muted/40 p-3">
              <p className="text-xs font-medium text-muted-foreground">
                {tSummary("title")}
              </p>
              <p className="mt-1 text-sm">{summary.headline}</p>
              <div className="mt-2 flex flex-wrap gap-1">
                {summary.chips.map((chip) => (
                  <Badge key={chip} variant="outline" className="font-normal">
                    {chip}
                  </Badge>
                ))}
              </div>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={isSubmitting}
              >
                {tForm("cancel")}
              </Button>
              <Button
                type="submit"
                className="gap-1.5"
                disabled={isSubmitting || availability === "taken"}
              >
                {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
                {isSubmitting ? tForm("creating") : tForm("create")}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
