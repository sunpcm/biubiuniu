"use client";

import { Button } from "@/components/ui/button";
import { Gift, Heart } from "lucide-react";
import { useTranslations } from "next-intl";
import Image from "next/image";
import { useState } from "react";

export default function WechatDonate() {
  const [showQRCode, setShowQRCode] = useState(false);
  const t = useTranslations("Landing.Donation");

  return (
    <section className="bg-background py-16">
      <div className="container mx-auto px-4 text-center">
        <h2 className="mb-8 text-2xl font-bold md:text-3xl">{t("title")}</h2>
        <p className="mx-auto mb-6 max-w-xl text-sm text-muted-foreground">
          {t("description")}
        </p>
        <div className="flex justify-center">
          {!showQRCode ? (
            <Button
              onClick={() => setShowQRCode(true)}
              className="flex h-14 items-center gap-3 rounded-xl bg-linear-to-r from-pink-500 to-purple-600 px-8 text-lg font-medium text-white shadow-lg transition-transform hover:scale-105 hover:from-pink-600 hover:to-purple-700"
            >
              <Gift className="size-6" />
              {t("button")}
              <Heart className="size-5 text-red-300" />
            </Button>
          ) : (
            <div className="flex animate-in fade-in-0 flex-col items-center duration-500">
              <Image
                src="/weixin.png"
                alt={t("imageAlt")}
                width={300}
                height={300}
                className="mx-auto rounded-lg shadow-lg"
                priority
              />
              <p className="mt-4 text-center text-sm text-muted-foreground">
                {t("warning")}
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
