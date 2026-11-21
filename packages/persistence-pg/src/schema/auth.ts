/**
 * Auth domain schema — PostgreSQL (Drizzle) physical model.
 *
 * Faithful reproduction of the N2 reference `apps/web/src/lib/db/schema.ts`
 * auth/identity slice: `user_role`, `user`, `session`, `account`,
 * `verification`, `organization`, `member`, `invitation`, and `user_source`.
 * Export names, column names, types, constraints, indexes, and FK semantics
 * are preserved verbatim so the auth adapter and any future consumer can rely
 * on the N2 shapes.
 */

import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const userRoleEnum = pgEnum("user_role", [
  "user",
  "admin",
  "superadmin",
]);

export const user = pgTable("user", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").unique().notNull(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  name: text("name"),
  image: text("image"),
  role: userRoleEnum("role").default("user").notNull(),
  isAnonymous: boolean("is_anonymous").default(false).notNull(),
  stripeCustomerId: text("stripe_customer_id").unique(),
  creemCustomerId: text("creem_customer_id").unique(),
  paypalPayerId: text("paypal_payer_id").unique(),
  banned: boolean("banned"),
  banReason: text("ban_reason"),
  banExpires: timestamp("ban_expires"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

export type UserType = typeof user.$inferSelect;

export const session = pgTable("session", {
  id: uuid("id").primaryKey().defaultRandom(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: uuid("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  activeOrganizationId: uuid("active_organization_id"),
  impersonatedBy: uuid("impersonated_by"),
});

export const account = pgTable("account", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", {
    withTimezone: true,
  }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
    withTimezone: true,
  }),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

export const verification = pgTable("verification", {
  id: uuid("id").primaryKey().defaultRandom(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

export const organization = pgTable("organization", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  logo: text("logo"),
  metadata: text("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export type OrganizationRow = typeof organization.$inferSelect;

export const member = pgTable(
  "member",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role").default("member").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    organizationIdx: index("idx_member_organization_id").on(
      table.organizationId,
    ),
    userIdx: index("idx_member_user_id").on(table.userId),
    orgUserUnique: unique("uq_member_org_user").on(
      table.organizationId,
      table.userId,
    ),
  }),
);

export type MemberRow = typeof member.$inferSelect;

export const invitation = pgTable(
  "invitation",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role"),
    status: text("status").default("pending").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    inviterId: uuid("inviter_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    organizationIdx: index("idx_invitation_organization_id").on(
      table.organizationId,
    ),
    emailIdx: index("idx_invitation_email").on(table.email),
  }),
);

export type InvitationRow = typeof invitation.$inferSelect;

export const userSource = pgTable(
  "user_source",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .references(() => user.id, { onDelete: "cascade" })
      .notNull(),
    affCode: text("aff_code"),
    utmSource: text("utm_source"),
    utmMedium: text("utm_medium"),
    utmCampaign: text("utm_campaign"),
    utmTerm: text("utm_term"),
    utmContent: text("utm_content"),
    referrer: text("referrer"),
    referrerDomain: text("referrer_domain"),
    landingPage: text("landing_page"),
    userAgent: text("user_agent"),
    browser: text("browser"),
    browserVersion: text("browser_version"),
    os: text("os"),
    osVersion: text("os_version"),
    deviceType: text("device_type"),
    deviceBrand: text("device_brand"),
    deviceModel: text("device_model"),
    screenWidth: integer("screen_width"),
    screenHeight: integer("screen_height"),
    language: text("language"),
    timezone: text("timezone"),
    ipAddress: text("ip_address"),
    countryCode: varchar("country_code", { length: 2 }),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    userIdIdx: index("idx_user_source_user_id").on(table.userId),
    affCodeIdx: index("idx_user_source_aff_code").on(table.affCode),
    utmSourceIdx: index("idx_user_source_utm_source").on(table.utmSource),
    countryCodeIdx: index("idx_user_source_country_code").on(
      table.countryCode,
    ),
    createdAtIdx: index("idx_user_source_created_at").on(table.createdAt),
  }),
);
