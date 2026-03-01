// [CUSTOM: START] - JWT token refresh for cross-domain SSO (LearnFeynmanHelper)
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { user as userSchema } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { generateToken, verifyToken } from "@/lib/jwt";
import { headers } from "next/headers";

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return NextResponse.json(
        { error: "Missing or invalid authorization header" },
        { status: 401 },
      );
    }

    const token = authHeader.substring(7);

    // 验证现有令牌
    const decoded = verifyToken(token);
    if (!decoded || !decoded.userId) {
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    }

    // Get current session via Better Auth
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user) {
      return NextResponse.json({ error: "User not found" }, { status: 401 });
    }

    const currentUser = session.user;

    // 检查用户身份是否一致 - 如果用户切换了账号，拒绝刷新
    if (currentUser.id !== decoded.userId) {
      return NextResponse.json(
        {
          error: "User identity changed",
          message: "Please re-authenticate with the new account",
          requireReauth: true,
        },
        { status: 401 },
      );
    }

    // 获取用户档案 via Drizzle
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

    // 生成新令牌
    const newToken = generateToken({
      userId: currentUser.id,
      email: currentUser.email || "",
      name: profile?.name || currentUser.name || "",
      role: (profile?.role as "admin" | "user") || "user",
    });

    const response = NextResponse.json({
      success: true,
      token: newToken,
      user: {
        id: currentUser.id,
        email: currentUser.email,
        name: profile?.name || currentUser.name || "",
        role: (profile?.role as "admin" | "user") || "user",
      },
    });

    // 设置 CORS 头
    const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(",") || [];
    const origin = request.headers.get("origin");
    if (origin && allowedOrigins.includes(origin)) {
      response.headers.set("Access-Control-Allow-Origin", origin);
    }
    response.headers.set("Access-Control-Allow-Methods", "POST");
    response.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");

    return response;
  } catch (error) {
    console.error("Token refresh error:", error);
    return NextResponse.json({ error: "Token refresh failed" }, { status: 500 });
  }
}

export async function OPTIONS(request: NextRequest) {
  const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(",") || [];
  const origin = request.headers.get("origin");

  const response = new NextResponse(null, { status: 200 });

  if (origin && allowedOrigins.includes(origin)) {
    response.headers.set("Access-Control-Allow-Origin", origin);
  }
  response.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  response.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");

  return response;
}
// [CUSTOM: END]
