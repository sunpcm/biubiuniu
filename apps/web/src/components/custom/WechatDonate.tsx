// [CUSTOM: START] - WeChat donation QR code component
"use client";

import { Button } from "@niu/ui/button";
import { Heart, Gift } from "lucide-react";
import { useTranslations } from "next-intl";
import Image from "next/image";
import { useState } from "react";

export default function WechatDonate() {
  const [showQRCode, setShowQRCode] = useState(false);
  const t = useTranslations("Landing.TempDonation");

  return (
    <section className="bg-background py-16">
      <div className="container mx-auto px-4 text-center">
        <h2 className="mb-8 text-2xl font-bold md:text-3xl">{t("title")}</h2>
        <div className="flex justify-center">
          <div className="flex flex-col items-center">
            {!showQRCode ? (
              <Button
                onClick={() => setShowQRCode(true)}
                className="flex transform items-center gap-3 rounded-xl bg-gradient-to-r from-pink-500 to-purple-600 px-8 py-6 text-lg font-medium text-white shadow-lg transition-all duration-200 hover:scale-105 hover:from-pink-600 hover:to-purple-700 hover:shadow-xl"
              >
                <Gift className="h-6 w-6" />
                {t("button")}
                <Heart className="h-5 w-5 text-red-300" />
              </Button>
            ) : (
              <div className="animate-in fade-in-0 flex flex-col items-center duration-500">
                <Image
                  src="/weixin.png"
                  alt="WeChat QR Code"
                  width={300}
                  height={300}
                  className="mx-auto [animation:shake_0.5s_ease-in-out_3] rounded-lg shadow-lg"
                  style={{
                    animation: `
                      fadeIn 0.5s ease-in-out,
                      shake 0.5s ease-in-out 0.5s 1
                    `,
                  }}
                  priority
                />
                <p className="text-muted-foreground mt-4 text-center text-sm">{t("warning")}</p>
                <style jsx>{`
                  @keyframes shake {
                    0%,
                    100% {
                      transform: translateX(0);
                    }
                    10%,
                    30%,
                    50%,
                    70%,
                    90% {
                      transform: translateX(-5px);
                    }
                    20%,
                    40%,
                    60%,
                    80% {
                      transform: translateX(5px);
                    }
                  }
                  @keyframes fadeIn {
                    from {
                      opacity: 0;
                    }
                    to {
                      opacity: 1;
                    }
                  }
                `}</style>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
// [CUSTOM: END]
