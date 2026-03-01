// [CUSTOM: START] - JWT token verification for cross-domain SSO (LearnFeynmanHelper)
import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/jwt";

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return NextResponse.json(
        {
          valid: false,
          error: "Missing or invalid authorization header",
          message: "Authorization header is required",
        },
        { status: 401 },
      );
    }

    const token = authHeader.substring(7);
    const payload = verifyToken(token);

    const response = NextResponse.json({
      valid: true,
      user: {
        id: payload.userId,
        email: payload.email,
        name: payload.name,
        role: payload.role,
      },
      message: "Token is valid",
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
    console.error("Token verification error:", error);

    const response = NextResponse.json(
      {
        valid: false,
        error: "Invalid token",
        message: error instanceof Error ? error.message : "Token verification failed",
      },
      { status: 401 },
    );

    // Add CORS headers even for error responses
    const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(",") || [];
    const origin = request.headers.get("origin");

    if (origin && allowedOrigins.includes(origin)) {
      response.headers.set("Access-Control-Allow-Origin", origin);
      response.headers.set("Access-Control-Allow-Credentials", "true");
    }

    return response;
  }
}

export async function POST(request: NextRequest) {
  try {
    const { token } = await request.json();

    if (!token) {
      return NextResponse.json(
        {
          valid: false,
          error: "Token is required",
          message: "No token provided",
        },
        { status: 400 },
      );
    }

    const payload = verifyToken(token);

    const response = NextResponse.json({
      valid: true,
      user: {
        id: payload.userId,
        email: payload.email,
        name: payload.name,
        role: payload.role,
      },
      message: "Token is valid",
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
    console.error("Token verification error:", error);

    const response = NextResponse.json(
      {
        valid: false,
        error: "Invalid token",
        message: error instanceof Error ? error.message : "Token verification failed",
      },
      { status: 401 },
    );

    // Add CORS headers even for error responses
    const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(",") || [];
    const origin = request.headers.get("origin");

    if (origin && allowedOrigins.includes(origin)) {
      response.headers.set("Access-Control-Allow-Origin", origin);
      response.headers.set("Access-Control-Allow-Credentials", "true");
    }

    return response;
  }
}

export async function OPTIONS(request: NextRequest) {
  const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(",") || [];
  const origin = request.headers.get("origin");

  const response = new NextResponse(null, { status: 200 });

  if (origin && allowedOrigins.includes(origin)) {
    response.headers.set("Access-Control-Allow-Origin", origin);
    response.headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    response.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    response.headers.set("Access-Control-Allow-Credentials", "true");
  }

  return response;
}
// [CUSTOM: END]
