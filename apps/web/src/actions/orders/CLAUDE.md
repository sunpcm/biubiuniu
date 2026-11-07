# actions/orders/
> L2 | Parent: /CLAUDE.md

Session-guarded query layer over the orders table, plus the multi-provider refund entry point.

Files
- user.ts: User side — getMyOrders (paginated order history, plan names resolved from config/pricing by request locale).
- admin.ts: Admin side — getAdminOrders (paginated, filterable by user/status/type/provider/search), refundOrder (dispatches to the provider refund API; local state and credit clawback are written only by the webhook).

[PROTOCOL]: Update this header on changes, then check CLAUDE.md
