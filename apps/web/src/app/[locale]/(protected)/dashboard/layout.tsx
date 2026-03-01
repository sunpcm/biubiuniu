import { AuthGuard } from "@/components/auth/AuthGuard";
import SidebarInsetHeader from "@/components/header/SidebarInsetHeader";
import { SidebarInset, SidebarProvider } from "@niu/ui/sidebar";
import React from "react";
import { DashboardSidebar } from "./DashboardSidebar";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <SidebarProvider>
        <DashboardSidebar />
        <SidebarInset className="min-w-0">
          <SidebarInsetHeader />
          <div className="flex min-w-0 flex-1 flex-col gap-4 p-4 pt-0">
            <div className="min-h-screen min-w-0 flex-1 rounded-xl md:min-h-min">{children}</div>
          </div>
        </SidebarInset>
      </SidebarProvider>
    </AuthGuard>
  );
}
