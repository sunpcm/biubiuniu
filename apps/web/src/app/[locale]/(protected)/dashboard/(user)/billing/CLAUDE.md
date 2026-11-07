# app/[locale]/(protected)/dashboard/(user)/billing/
> L2 | Parent: /CLAUDE.md

Personal billing page — two credit buckets, current plan, purchase and credit history. In a team workspace a banner links to /dashboard/team.

Files
- page.tsx: Server entry — session guard, getUserBillingSummary, plan name by locale, generateMetadata.
- ManageSubscriptionButton.tsx: Opens the provider portal via createCustomerPortalSession.
- NextRefreshTime.tsx: Client component rendering the next credit grant as local time plus UTC (the scheduler runs in UTC); paints UTC during SSR and switches to local after mount so hydration never tears. Shown only when the subscription has a nextGrantAt (annual drip).
- BillingHistory.tsx: History tabs — purchase table and credit ledger table, each independently paginated (PAGE_SIZE = 10) through the shared table kit: usePagedQuery for page state and the three loading signals, DataTableContainer / DataTableEmptyState for the shell, TablePagination fed Billing translations via info / navLabels. Failures toast and return an empty page so the rest of the billing page stays usable.

i18n: `Billing` namespace (i18n/messages/{en,zh,ja}/Dashboard/User/Billing.json)

[PROTOCOL]: Update this header on changes, then check CLAUDE.md
