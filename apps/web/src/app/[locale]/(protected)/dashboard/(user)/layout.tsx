/**
 * [INPUT]: Depends on react's ReactNode
 * [OUTPUT]: Exports UserDashboardLayout, the shared container of the user-side
 *           dashboard pages (centered, width-capped)
 * [POS]: Layout of the dashboard/(user) route group. Padding comes from the
 *        parent dashboard/layout's SidebarInset (the admin group stays full
 *        width); the user group adds one centered container here so pages only
 *        care about content. flex-1 / min-h-0 are kept so credit-history and
 *        my-orders can still stretch their tables to the viewport
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */

export default function UserDashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="container mx-auto flex flex-col flex-1 min-h-0">
      {children}
    </div>
  );
}
