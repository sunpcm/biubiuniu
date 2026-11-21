# lib/credits/

Thin app facade over `@sunpcm/niu-commerce`. `ledger.ts` keeps the historical write names. `createCredits(app)` and `createCreditLedger(app)` close over one explicit `AppCommerce`; callers that need several writes to commit together use `runCommerceTransaction`, which calls `coordinatePgCommerce` with that same app's store and commerce instance. There is no adopt entry for an outside database handle and no process-global instance setter. Production keeps the historical exports as lazy wrappers over `getAppCommerce()`.
