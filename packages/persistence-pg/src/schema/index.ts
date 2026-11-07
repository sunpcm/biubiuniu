/**
 * Schema entry marker.
 *
 * This module intentionally does NOT aggregate the auth and commerce tables.
 * Consumers import concrete slices via the `/schema/auth` and `/schema/commerce`
 * package subpaths so importing one domain never drags in the other, and the
 * package root never performs full-schema initialization.
 */
export {};
