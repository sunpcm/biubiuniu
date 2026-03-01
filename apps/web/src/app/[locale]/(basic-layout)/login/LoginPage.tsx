"use client";

import LoginForm from "@/components/auth/LoginForm";
import { useRouter } from "@/i18n/routing";
import { authClient } from "@/lib/auth/auth-client";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Suspense, useEffect } from "react";

export default function LoginPage() {
  const router = useRouter();
  const { data: session } = authClient.useSession();

  const t = useTranslations("Login");

  useEffect(() => {
    if (session?.user) {
      router.replace("/");
    }
  }, [session?.user]);

  if (session?.user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-4 w-4 animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex flex-1 items-center justify-center py-12">
      <div className="flex flex-col space-y-6">
        <div className="flex flex-col space-y-2 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="text-muted-foreground text-sm">{t("description")}</p>
        </div>

        <Suspense fallback={<Loader2 className="h-4 w-4 animate-spin" />}>
          <LoginForm className="w-[300px]" />
        </Suspense>
      </div>
    </div>
  );
}
