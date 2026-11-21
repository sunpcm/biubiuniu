/**
 * [INPUT]: Depends on @/actions/users/signup-blocklist's getSignupBlocklistAdmin/
 *          updateSignupBlocklistAdmin, next-intl's useTranslations,
 *          @/components/ui's Sheet/Textarea/Label/Button/Skeleton
 * [OUTPUT]: exports the SignupBlocklistSheet component (a signup-email blocklist
 *           management side sheet with its own trigger button: prefix / suffix /
 *           exact-email plus IP rule groups, one rule per line)
 * [POS]: The signup-blocklist interaction layer of admin/users, mounted into the
 *        DataTable toolbar's actions slot; loads the current rules on open, and
 *        saving takes effect at once (the signup hook reads Redis live)
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */

"use client";

import {
  getSignupBlocklistAdmin,
  updateSignupBlocklistAdmin,
} from "@/actions/users/signup-blocklist";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { ShieldBan } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";

// ── Conversion between the textarea (one rule per line) and the rule array ──
const linesToRules = (text: string): string[] =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

const rulesToLines = (rules: string[]): string => rules.join("\n");

export function SignupBlocklistSheet() {
  const t = useTranslations("Users.blocklist");
  const [open, setOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isPending, startTransition] = useTransition();

  const [prefixes, setPrefixes] = useState("");
  const [suffixes, setSuffixes] = useState("");
  const [exact, setExact] = useState("");
  const [ips, setIps] = useState("");

  // ── Load the currently effective rules on open ──
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setIsLoading(true);

    getSignupBlocklistAdmin()
      .then((res) => {
        if (cancelled) return;
        if (res.success && res.data) {
          setPrefixes(rulesToLines(res.data.prefixes));
          setSuffixes(rulesToLines(res.data.suffixes));
          setExact(rulesToLines(res.data.exact));
          // Rules saved before the IP group existed have no ips field
          setIps(rulesToLines(res.data.ips ?? []));
        } else {
          toast.error(t("loadFailed"), {
            description: res.success ? undefined : res.error,
          });
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // `t` is deliberately absent: next-intl rebuilds it whenever the layout
    // re-renders, which would re-enter this effect on every RSC pass. Locale
    // changes remount the tree, so the closure can never go stale.
  }, [open]);

  const handleSave = () => {
    startTransition(async () => {
      const res = await updateSignupBlocklistAdmin({
        prefixes: linesToRules(prefixes),
        suffixes: linesToRules(suffixes),
        exact: linesToRules(exact),
        ips: linesToRules(ips),
      });
      if (res.success) {
        toast.success(t("success"));
        setOpen(false);
      } else {
        toast.error(t("failed"), { description: res.error });
      }
    });
  };

  const fields = [
    {
      id: "blocklist-prefixes",
      label: t("prefixesLabel"),
      hint: t("prefixesHint"),
      value: prefixes,
      onChange: setPrefixes,
    },
    {
      id: "blocklist-suffixes",
      label: t("suffixesLabel"),
      hint: t("suffixesHint"),
      value: suffixes,
      onChange: setSuffixes,
    },
    {
      id: "blocklist-exact",
      label: t("exactLabel"),
      hint: t("exactHint"),
      value: exact,
      onChange: setExact,
    },
    {
      id: "blocklist-ips",
      label: t("ipsLabel"),
      hint: t("ipsHint"),
      value: ips,
      onChange: setIps,
    },
  ];

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm" className="h-8">
          <ShieldBan className="size-4" />
          {t("action")}
        </Button>
      </SheetTrigger>
      <SheetContent className="flex w-full flex-col gap-0 overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{t("title")}</SheetTitle>
          <SheetDescription>{t("description")}</SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-6 px-4 pb-4">
          {fields.map((field) => (
            <div key={field.id} className="space-y-2">
              <Label htmlFor={field.id}>{field.label}</Label>
              {isLoading ? (
                <Skeleton className="h-28 w-full" />
              ) : (
                <Textarea
                  id={field.id}
                  rows={5}
                  className="font-mono text-sm"
                  placeholder={t("placeholder")}
                  value={field.value}
                  onChange={(e) => field.onChange(e.target.value)}
                />
              )}
              <p className="text-xs text-muted-foreground">{field.hint}</p>
            </div>
          ))}
        </div>

        <div className="sticky bottom-0 border-t bg-background p-4">
          <Button
            className="w-full"
            onClick={handleSave}
            disabled={isLoading || isPending}
          >
            {isPending ? t("saving") : t("save")}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
