// [CUSTOM: START] - Custom Hero component replacing upstream Hero
"use client";

import { Button } from "@niu/ui/button";
import { RainbowButton } from "@niu/ui/rainbow-button";
import { siteConfig } from "@/config/site";
import { useTranslations } from "next-intl";
import Link from "next/link";
import Image from "next/image";
import { useState, useEffect } from "react";
import { SiDiscord } from "react-icons/si";
import { useAuth } from "@/components/providers/AuthProvider";

export default function Hero1() {
  const t = useTranslations("Landing.TempHero");
  const { user } = useAuth();
  const [showArrow, setShowArrow] = useState(true);
  const [isVisible, setIsVisible] = useState(true);

  // 3秒后淡出关闭箭头
  useEffect(() => {
    const timer = setTimeout(() => {
      setIsVisible(false);
      // 等待淡出动画完成后再隐藏元素
      setTimeout(() => {
        setShowArrow(false);
      }, 300);
    }, 3000);

    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="w-full">
      <div className="container mx-auto">
        <div className="flex flex-col items-center justify-center gap-8 py-16 lg:py-24 2xl:py-40">
          <div className="flex max-w-3xl flex-col gap-4">
            <h1 className="z-10 text-center font-sans text-lg font-bold md:text-7xl">
              <span className="from-foreground to-muted-foreground bg-gradient-to-b bg-clip-text text-transparent">
                {t("title")}
              </span>
              🍻
            </h1>

            <p className="text-muted-foreground text-center text-lg leading-relaxed tracking-tight md:text-xl">
              {t("description")}
            </p>
          </div>
          <div className="relative flex flex-row gap-2">
            <RainbowButton>
              <Link href={"/nano"} className="flex items-center gap-2">
                {t("nanoBananaButton")}
              </Link>
            </RainbowButton>
            {/* 箭头指向按钮 - 只在未登录时显示，3秒后淡出关闭 */}
            {showArrow && !user && (
              <div
                className={`group pointer-events-none absolute top-10 -right-110 h-20 w-20 animate-bounce transition-opacity duration-300 [animation-duration:1s] ${isVisible ? "opacity-100" : "opacity-0"}`}
              >
                <div className="relative h-full w-full">
                  <Image
                    src="/arrow.svg"
                    alt="点击箭头"
                    width={80}
                    height={80}
                    className="rotate-12 transform"
                  />
                  {/* 手动关闭按钮 - hover时显示 */}
                  <button
                    onClick={() => {
                      setIsVisible(false);
                      setTimeout(() => {
                        setShowArrow(false);
                      }, 300);
                    }}
                    className="pointer-events-auto absolute -top-2 -right-2 flex h-6 w-6 scale-75 items-center justify-center rounded-full bg-gray-800 text-white opacity-0 shadow-md transition-all duration-200 group-hover:scale-100 group-hover:opacity-100 hover:bg-gray-700"
                    aria-label="关闭箭头提示"
                  >
                    <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M6 18L18 6M6 6l12 12"
                      />
                    </svg>
                  </button>
                </div>
              </div>
            )}
            <Button
              className="h-11 rounded-xl border-2 border-indigo-500 bg-white px-8 py-2 text-indigo-500 hover:text-indigo-600"
              variant="outline"
              asChild
            >
              <Link
                href={siteConfig.socialLinks?.discord || "https://discord.gg/4sSVt8b2"}
                target="_blank"
                rel="noopener noreferrer nofollow"
                title="Join Discord"
                prefetch={false}
                className="flex items-center gap-2"
              >
                <SiDiscord className="h-4 w-4 text-indigo-500" />
                {t("discordButton")}
              </Link>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
// [CUSTOM: END]
