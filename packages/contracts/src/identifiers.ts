/**
 * Stable, opaque entity identifiers.
 *
 * Database primary keys are UUID strings at runtime. The phantom brand exists
 * only at compile time: it makes a primary key visually distinct from other
 * strings in cross-package DTO signatures while carrying no runtime cost.
 */
export type EntityId = string & { readonly __brand: "EntityId" };

/** Treat a raw UUID string as an entity identifier. */
export function entityId(value: string): EntityId {
  return value as EntityId;
}
