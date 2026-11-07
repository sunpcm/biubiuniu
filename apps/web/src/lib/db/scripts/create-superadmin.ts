/**
 * Script to create a superadmin user
 *
 * This script creates a superadmin user with the provided email.
 * The user can log in using email OTP verification without registration.
 *
 * Usage: pnpm create-superadmin <email>
 * Example: pnpm create-superadmin admin@example.com
 */

import { createDatabase } from "@/lib/db/config";
import { user } from "@/lib/db/schema";
import { isSuperAdminUserRole } from "@/lib/auth/permissions";
import { isValidEmail } from "@/lib/validations";
import { loadEnvConfig } from '@next/env';
import 'dotenv/config';
import { eq } from "drizzle-orm";

// Load environment variables from .env files
const projectDir = process.cwd();
loadEnvConfig(projectDir);

async function createSuperadmin(email: string) {
  // Check DATABASE_URL before proceeding
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL environment variable is not set');
  }

  // Create database connection
  const db = createDatabase({ connectionString });

  try {
    console.log("Creating superadmin user...");
    console.log(`Email: ${email}`);

    // Validate email format
    if (!isValidEmail(email)) {
      throw new Error("Invalid email format");
    }

    // Check if user with this email already exists
    const existingUsers = await db
      .select()
      .from(user)
      .where(eq(user.email, email))
      .limit(1);

    if (existingUsers.length > 0) {
      const existingUser = existingUsers[0];

      // If user exists, update their role to superadmin
      if (isSuperAdminUserRole(existingUser.role)) {
        console.log(`✅ User ${email} is already a superadmin`);
        return;
      }

      await db
        .update(user)
        .set({
          role: 'superadmin',
          emailVerified: true,
          updatedAt: new Date(),
        })
        .where(eq(user.id, existingUser.id));

      console.log(`✅ Updated existing user ${email} to superadmin`);
      console.log(`User ID: ${existingUser.id}`);
      return;
    }

    // Create new superadmin user
    const newUsers = await db
      .insert(user)
      .values({
        email,
        emailVerified: true,
        role: 'superadmin',
        name: 'Super Admin',
      })
      .returning();

    const newUser = newUsers[0];
    if (!newUser) {
      throw new Error("Failed to create user");
    }

    console.log(`✅ Successfully created superadmin user`);
    console.log(`User ID: ${newUser.id}`);
    console.log(`Email: ${email}`);
    console.log(`\nThe superadmin can now log in using email OTP verification.`);

  } catch (error) {
    console.error("Failed to create superadmin:", error);
    throw error;
  }
}

// Main execution
async function main() {
  const email = process.argv[2];

  if (!email) {
    console.error("❌ Error: Email is required");
    console.log("\nUsage: pnpm create-superadmin <email>");
    console.log("Example: pnpm create-superadmin admin@example.com");
    process.exit(1);
  }

  try {
    await createSuperadmin(email);
    console.log("\n✅ Operation completed successfully!");
    process.exit(0);
  } catch (error) {
    console.error("\n❌ Operation failed:", error);
    process.exit(1);
  }
}

main();
