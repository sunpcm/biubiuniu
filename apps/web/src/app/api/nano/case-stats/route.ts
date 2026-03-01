// [CUSTOM: START] - Nano case stats tracking
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { headers } from "next/headers";

// 记录案例选择
export async function POST(request: NextRequest) {
  try {
    const { caseId } = await request.json();

    if (!caseId) {
      return NextResponse.json({ success: false, error: "Case ID is required" }, { status: 400 });
    }

    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user) {
      return NextResponse.json(
        { success: false, error: "Authentication required" },
        { status: 401 },
      );
    }

    // 记录案例选择到数据库 (raw SQL since nano_case_stats is not in Drizzle schema yet)
    await db.execute(
      sql`INSERT INTO nano_case_stats (case_id, user_id, selected_at) VALUES (${caseId}, ${session.user.id}, NOW())`,
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
  }
}

// 获取热门案例统计
export async function GET() {
  try {
    // 获取最近30天的案例选择统计 (raw SQL)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const result = await db.execute(
      sql`SELECT case_id FROM nano_case_stats WHERE selected_at >= ${thirtyDaysAgo} ORDER BY selected_at DESC`,
    );

    // 统计每个案例的选择次数
    const caseStats: Record<string, number> = {};
    (result as unknown as Array<{ case_id: string }>)?.forEach((item) => {
      caseStats[item.case_id] = (caseStats[item.case_id] || 0) + 1;
    });

    // 获取前三个最热门的案例
    const topCases = Object.entries(caseStats)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 3)
      .map(([caseId]) => caseId);

    return NextResponse.json({
      success: true,
      data: {
        topCases,
        stats: caseStats,
      },
    });
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
  }
}
// [CUSTOM: END]
