/**
 * [INPUT]: Depends on @/constants/feedback for FEEDBACK_DRAFT_KEY/FEEDBACK_DRAFT_TTL
 * [OUTPUT]: Exports FeedbackProvider component, useFeedback hook
 * [POS]: Context provider for feedback dialog state and localStorage draft persistence,
 *        consumed by FeedbackFab, FeedbackDialog, FeedbackForm
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */

"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";

import { FEEDBACK_DRAFT_KEY, FEEDBACK_DRAFT_TTL } from "@/constants/feedback";

// ============================================================
// Types
// ============================================================

type FeedbackDraft = {
  type: string;
  title: string;
  description: string;
  savedAt: number;
};

type FeedbackContextType = {
  isOpen: boolean;
  openDialog: () => void;
  closeDialog: () => void;
  draft: FeedbackDraft | null;
  saveDraft: (data: Omit<FeedbackDraft, "savedAt">) => void;
  clearDraft: () => void;
};

// ============================================================
// Context
// ============================================================

const FeedbackContext = createContext<FeedbackContextType | null>(null);

export function useFeedback() {
  const ctx = useContext(FeedbackContext);
  if (!ctx) throw new Error("useFeedback must be used within FeedbackProvider");
  return ctx;
}

// ============================================================
// localStorage helpers
// ============================================================

function readDraft(): FeedbackDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(FEEDBACK_DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as FeedbackDraft;
    if (Date.now() - parsed.savedAt > FEEDBACK_DRAFT_TTL) {
      try {
        localStorage.removeItem(FEEDBACK_DRAFT_KEY);
      } catch {
        // ignore storage errors
      }
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeDraft(data: Omit<FeedbackDraft, "savedAt">): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(
      FEEDBACK_DRAFT_KEY,
      JSON.stringify({ ...data, savedAt: Date.now() }),
    );
  } catch {
    // ignore storage errors (e.g. quota exceeded)
  }
}

function removeDraft(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(FEEDBACK_DRAFT_KEY);
  } catch {
    // ignore storage errors
  }
}

// ============================================================
// Provider
// ============================================================

export function FeedbackProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [draft, setDraft] = useState<FeedbackDraft | null>(null);

  useEffect(() => {
    setDraft(readDraft());
  }, []);

  const openDialog = useCallback(() => setIsOpen(true), []);
  const closeDialog = useCallback(() => setIsOpen(false), []);

  const saveDraft = useCallback((data: Omit<FeedbackDraft, "savedAt">) => {
    writeDraft(data);
    setDraft({ ...data, savedAt: Date.now() });
  }, []);

  const clearDraft = useCallback(() => {
    removeDraft();
    setDraft(null);
  }, []);

  return (
    <FeedbackContext.Provider
      value={{
        isOpen,
        openDialog,
        closeDialog,
        draft,
        saveDraft,
        clearDraft,
      }}
    >
      {children}
    </FeedbackContext.Provider>
  );
}
