// [CUSTOM: START] - JWT token generation for cross-domain SSO (LearnFeynmanHelper)
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@niu/db";
import { user as userSchema } from "@niu/db/schema";
import { eq } from "drizzle-orm";
import { generateToken } from "@/lib/jwt";
import { headers } from "next/headers";

export async function GET(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });

    if (!session?.user) {
      return NextResponse.json(
        {
          success: false,
          error: "Authentication required",
          message: "User not authenticated",
        },
        { status: 401 },
      );
    }

    const currentUser = session.user;

    // Get user profile for role information from Drizzle
    const userDataResults = await db
      .select({
        role: userSchema.role,
        name: userSchema.name,
        image: userSchema.image,
      })
      .from(userSchema)
      .where(eq(userSchema.id, currentUser.id))
      .limit(1);

    const profile = userDataResults[0];

    const tokenPayload = {
      userId: currentUser.id,
      email: currentUser.email,
      role: (profile?.role as "admin" | "user") || "user",
      name: profile?.name || currentUser.name || currentUser.email.split("@")[0],
      avatar: profile?.image || currentUser.image || undefined,
    };

    const token = generateToken(tokenPayload);

    // Set CORS headers for cross-domain access
    const response = NextResponse.json({
      success: true,
      token,
      user: tokenPayload,
      expiresIn: process.env.JWT_EXPIRES_IN || "7d",
    });

    // Add CORS headers
    const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(",") || [];
    const origin = request.headers.get("origin");

    if (origin && allowedOrigins.includes(origin)) {
      response.headers.set("Access-Control-Allow-Origin", origin);
      response.headers.set("Access-Control-Allow-Credentials", "true");
    }

    return response;
  } catch (error) {
    console.error("Token generation error:", error);
    return NextResponse.json(
      {
        success: false,
        error: "Internal server error",
        message: "Failed to generate token",
      },
      { status: 500 },
    );
  }
}

export async function OPTIONS(request: NextRequest) {
  const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(",") || [];
  const origin = request.headers.get("origin");

  const response = new NextResponse(null, { status: 200 });

  if (origin && allowedOrigins.includes(origin)) {
    response.headers.set("Access-Control-Allow-Origin", origin);
    response.headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
    response.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    response.headers.set("Access-Control-Allow-Credentials", "true");
  }

  return response;
}
// [CUSTOM: END]
