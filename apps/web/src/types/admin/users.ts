// [CUSTOM: START] - User type for admin pages
// Previously imported from Supabase types; now defined directly to match Drizzle schema
export type UserType = {
  id: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
  image: string | null;
  role: "user" | "admin";
  isAnonymous: boolean;
  referral: string | null;
  stripeCustomerId: string | null;
  banned: boolean | null;
  banReason: string | null;
  banExpires: Date | null;
  createdAt: Date;
  updatedAt: Date;
  usage?: {
    one_time_credits_balance: number;
    subscription_credits_balance: number;
    total_credits?: number;
  };
};
// [CUSTOM: END]
