/**
 * [INPUT]: depends on @/lib/redis redis instance and provider-level Resend contact operations
 * [OUTPUT]: exports addContact, removeContact, isContact
 * [POS]: lib/mail contact management layer; Resend uses the native contacts API plus Redis, Cloudflare uses Redis only
 * [PROTOCOL]: Update this header when changed, then check CLAUDE.md
 */

import { redis } from "@/lib/redis";
import type { EmailProviderName } from "./types";
import { addContactWithResend, removeContactWithResend } from "./providers/resend";

const REDIS_CONTACTS_KEY = "email:contacts";

export async function addContact(email: string, provider: EmailProviderName): Promise<void> {
  if (provider === "resend") {
    await addContactWithResend(email).catch(() => {
      // Resend contact write failures should not block the main flow.
    });
  }

  if (redis) {
    await redis.sadd(REDIS_CONTACTS_KEY, email);
  }
}

export async function removeContact(email: string): Promise<void> {
  // Clean up both Resend and Redis to keep unsubscribe working across provider switches.
  await removeContactWithResend(email).catch(() => {});

  if (redis) {
    await redis.srem(REDIS_CONTACTS_KEY, email);
  }
}

export async function isContact(email: string): Promise<boolean> {
  if (!redis) return false;
  return (await redis.sismember(REDIS_CONTACTS_KEY, email)) === 1;
}
