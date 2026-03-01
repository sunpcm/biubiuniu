// [CUSTOM: START] - Cross-domain SSO login page for LearnFeynmanHelper
"use client";

import { useEffect, useRef } from "react";
import { useAuth } from "@/components/providers/AuthProvider";
import { useSearchParams } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@niu/ui/card";
import { Loader2 } from "lucide-react";
import LoginForm from "@/components/auth/LoginForm";

export default function CrossAppLoginPage() {
  const { user, loading } = useAuth();
  const searchParams = useSearchParams();
  const redirectUrl = searchParams.get("redirect");
  const hasProcessed = useRef(false);

  useEffect(() => {
    if (loading || hasProcessed.current) return;

    if (user && redirectUrl) {
      hasProcessed.current = true;
      handleAuthSuccess();
    }
  }, [user, loading, redirectUrl]);

  const handleAuthSuccess = async () => {
    try {
      // Generate token for the authenticated user
      const response = await fetch("/api/auth/token");
      const data = await response.json();

      if (data.success && window.opener) {
        // Send token back to the parent window (learner app)
        window.opener.postMessage(
          {
            type: "auth-success",
            token: data.token,
            user: data.user,
          },
          redirectUrl || "*",
        );

        window.close();
      } else if (redirectUrl) {
        // Fallback: redirect with token in URL (less secure, but works)
        const url = new URL(redirectUrl);
        url.searchParams.set("token", data.token);
        window.location.href = url.toString();
      }
    } catch (error) {
      console.error("Auth token generation failed:", error);
      if (window.opener) {
        window.opener.postMessage(
          {
            type: "auth-error",
            error: "Failed to generate authentication token",
          },
          redirectUrl || "*",
        );
        window.close();
      }
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100">
        <Card className="w-full max-w-md">
          <CardContent className="flex flex-col items-center justify-center p-8">
            <Loader2 className="mb-4 h-8 w-8 animate-spin text-blue-500" />
            <p className="text-muted-foreground text-sm">检查认证状态中...</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-green-50 to-emerald-100">
        <Card className="w-full max-w-md">
          <CardContent className="flex flex-col items-center justify-center p-8">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-500">
              <svg
                className="h-8 w-8 text-white"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 13l4 4L19 7"
                />
              </svg>
            </div>
            <h3 className="mb-2 text-lg font-semibold text-gray-900">认证成功</h3>
            <p className="text-muted-foreground text-center text-sm">正在跳转到学习应用...</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl font-bold">登录 BiuBiuNiu</CardTitle>
          <CardDescription>登录后将自动跳转到学习应用</CardDescription>
        </CardHeader>
        <CardContent>
          <LoginForm />

          {redirectUrl && (
            <div className="mt-4 rounded-md border border-blue-200 bg-blue-50 p-3">
              <p className="text-xs text-blue-700">
                <strong>重定向目标:</strong> {new URL(redirectUrl).hostname}
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
// [CUSTOM: END]
