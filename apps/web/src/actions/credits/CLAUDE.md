# actions/credits/
> L2 | Parent: /CLAUDE.md

Session-guarded shell over lib/credits.

Files
- index.ts: User side — getMyBillingSummary, getMyCredits, getMyCreditHistory, consumeCredits (the entry point business features use to spend credits).
- admin.ts: Admin side — adjustUserCredits, getUserCreditsForAdmin, getAdminCreditTransactions (global ledger audit), grantCreditsToUsers (batch grant by email, max 200).

[PROTOCOL]: Update this header on changes, then check CLAUDE.md
