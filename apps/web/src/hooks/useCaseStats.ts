// [CUSTOM: START] - Nano case stats hook
"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/components/providers/AuthProvider";

export function useCaseStats() {
  const { user } = useAuth();
  const [topCases, setTopCases] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  // 获取热门案例统计
  const fetchTopCases = async () => {
    try {
      setLoading(true);
      const response = await fetch("/api/nano/case-stats");
      const result = await response.json();

      if (result.success && result.data) {
        setTopCases(result.data.topCases || []);
        // 如果没有热门案例，默认使用第一个案例
        if (!result.data.topCases || result.data.topCases.length === 0) {
          setTopCases(["case1"]);
        }
      }
    } catch (error) {
      console.error("Failed to fetch top cases:", error);
      // 出错时使用默认案例
      setTopCases(["case1"]);
    } finally {
      setLoading(false);
    }
  };

  // 记录案例选择
  const recordCaseSelection = async (caseId: string) => {
    if (!user) return; // 只有登录用户才记录统计

    try {
      await fetch("/api/nano/case-stats", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ caseId }),
      });

      // 记录成功后重新获取统计数据
      await fetchTopCases();
    } catch (error) {
      console.error("Failed to record case selection:", error);
      // 记录失败不影响用户体验，静默处理
    }
  };

  useEffect(() => {
    fetchTopCases();
  }, []);

  return {
    topCases,
    loading,
    recordCaseSelection,
    refetch: fetchTopCases,
  };
}
// [CUSTOM: END]
