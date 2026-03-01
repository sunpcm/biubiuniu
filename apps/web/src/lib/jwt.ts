// [CUSTOM: START] - JWT utilities for cross-domain SSO (LearnFeynmanHelper)
import jwt from "jsonwebtoken";

export interface JWTPayload {
  userId: string;
  email: string;
  role: "admin" | "user";
  name?: string;
  avatar?: string;
}

export function generateToken(payload: JWTPayload): string {
  if (!process.env.JWT_SECRET) {
    throw new Error("JWT_SECRET is not defined");
  }

  const options: jwt.SignOptions = {
    expiresIn: Number(process.env.JWT_EXPIRES_IN || 7) * 24 * 60 * 60, // Convert days to seconds
    issuer: process.env.JWT_ISSUER,
    audience: [process.env.JWT_ISSUER!, process.env.JWT_AUDIENCE_LEARNER!],
  };

  return jwt.sign(payload, process.env.JWT_SECRET!, options);
}

export function verifyToken(token: string): JWTPayload {
  if (!process.env.JWT_SECRET) {
    throw new Error("JWT_SECRET is not defined");
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET, {
      issuer: process.env.JWT_ISSUER!,
      audience: [process.env.JWT_ISSUER!, process.env.JWT_AUDIENCE_LEARNER!],
    }) as JWTPayload;

    return decoded;
  } catch (error) {
    throw new Error(`Invalid token: ${error instanceof Error ? error.message : "Unknown error"}`);
  }
}

export function refreshToken(token: string): string {
  const payload = verifyToken(token);

  // Remove JWT specific fields before regenerating
  const { iat: _iat, exp: _exp, aud: _aud, iss: _iss, ...userPayload } = payload as any;

  return generateToken(userPayload as JWTPayload);
}
// [CUSTOM: END]
