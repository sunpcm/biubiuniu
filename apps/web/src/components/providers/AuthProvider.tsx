"use client";

// [CUSTOM: START] - Bridged AuthProvider that wraps Better Auth with useAuth() interface
// This provides backward compatibility for custom components (Hero1, MobileMenu, etc.)
// that use the useAuth() hook.

import React, { createContext, useContext, useState } from "react";
import LoginDialog from "@/components/auth/LoginDialog";
import { authClient } from "@/lib/auth/auth-client";

type SimpleUser = {
  id: string;
  email: string;
  role: "admin" | "user";
  name?: string | null;
  image?: string | null;
};

type AuthContextType = {
  user: SimpleUser | null;
  loading: boolean;
  signOut: () => Promise<void>;

  // login dialog
  showLoginDialog: () => void;
  hideLoginDialog: () => void;
  isLoginDialogOpen: boolean;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { data: session, isPending } = authClient.useSession();
  const [isLoginDialogOpen, setIsLoginDialogOpen] = useState(false);

  const user: SimpleUser | null = session?.user
    ? {
        id: session.user.id,
        email: session.user.email,
        role: ((session.user as Record<string, unknown>).role as "admin" | "user") || "user",
        name: session.user.name,
        image: session.user.image,
      }
    : null;

  const signOut = async () => {
    await authClient.signOut({
      fetchOptions: {
        onSuccess: () => {
          window.location.href = "/";
        },
      },
    });
  };

  const showLoginDialog = () => setIsLoginDialogOpen(true);
  const hideLoginDialog = () => setIsLoginDialogOpen(false);

  return (
    <AuthContext.Provider
      value={{
        user,
        loading: isPending,
        signOut,
        showLoginDialog,
        hideLoginDialog,
        isLoginDialogOpen,
      }}
    >
      {children}
      {process.env.NEXT_PUBLIC_LOGIN_MODE === "dialog" && (
        <LoginDialog open={isLoginDialogOpen} onOpenChange={setIsLoginDialogOpen} />
      )}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};
// [CUSTOM: END]
