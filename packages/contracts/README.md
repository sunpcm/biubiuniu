# @sunpcm/niu-contracts

Cross-boundary primitive contracts shared by domain and persistence packages.
This is a pure TypeScript leaf package with no runtime dependencies, no
framework, and no environment access.

## Exports

- `PaymentProvider` — `"stripe" | "creem" | "paypal"`, the canonical provider
  union mirrored by the PostgreSQL `payment_provider` enum.
- `PAYMENT_PROVIDERS` — a frozen runtime array of the same values, in stable
  order.
- `EntityId` / `entityId` — a phantom-branded UUID string type and constructor.
- `AppError` / `AppErrorOptions` / `ErrorKind` — a minimal error base with a
  stable machine-readable `code`, `kind`, and `retryable` policy.

## Ownership

This package is owned by the persistence foundation. Domain packages must not
edit these files; any additional cross-boundary type they need should be
requested via their delivery report and reconciled by the integration owner.
