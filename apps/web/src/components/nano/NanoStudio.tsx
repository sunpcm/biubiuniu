"use client";

import LoginButton from "@/components/header/LoginButton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { getNanoCaseById, isNanoCaseId } from "@/config/nano-cases";
import { authClient } from "@/lib/auth/auth-client";
import { useTranslations } from "next-intl";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import {
  type NanoAdmitPayload,
  type NanoTaskDto,
  type NanoTaskListDto,
  type NanoTaskSummary,
  type UseNanoTaskApi,
} from "@sunpcm/niu-feature-nano/react";
import { useNanoTask } from "@sunpcm/niu-feature-nano/react";
import {
  createRequestKey,
  isNanoCaseStats,
  isNanoTask,
  NANO_API_BASE,
  NANO_ERROR_CODES,
  NANO_LOCAL_TASK_KEY,
  nanoInputFingerprint,
  toNanoClientError,
  validateNanoInput,
} from "./contract";
import type { NanoClientError } from "./contract";
import type {
  NanoCaseStats,
  NanoPublicConfig,
  NanoTask as UiNanoTask,
} from "./types";
import { NanoCaseGallery } from "./NanoCaseGallery";
import { NanoImage } from "./NanoImage";
import { NanoResultPanel } from "./NanoResultPanel";
import { NanoTaskHistory } from "./NanoTaskHistory";

interface NanoStudioProps {
  config: NanoPublicConfig;
}

interface UploadState {
  file: File | null;
  mimeType: string;
  dataBase64: string;
  bytes: number;
  previewUrl: string | null;
  sourceUrl: string | null;
}

const EMPTY_UPLOAD: UploadState = {
  file: null,
  mimeType: "",
  dataBase64: "",
  bytes: 0,
  previewUrl: null,
  sourceUrl: null,
};

type NanoAdmitResult = Awaited<ReturnType<UseNanoTaskApi["admit"]>>;

function nanoCodeError(code: string): NanoClientError & Error {
  return Object.assign(new Error(code), { code, status: 0 });
}

/** Stable HTTP envelope from the frozen public API; hook returns unwrapped data. */
async function readCaseStats(signal?: AbortSignal): Promise<NanoCaseStats> {
  const response = await fetch(`${NANO_API_BASE}/case-stats`, { signal });
  const envelope = (await response.json().catch(() => null)) as {
    success?: boolean;
    data?: unknown;
    code?: string;
    error?: string;
  } | null;
  if (!response.ok || !envelope?.success || !isNanoCaseStats(envelope.data)) {
    throw nanoCodeError(envelope?.code ?? "INTERNAL");
  }
  return envelope.data as NanoCaseStats;
}

async function recordCaseSelection(
  caseId: string,
  requestKey: string,
): Promise<boolean> {
  // One click is one real selection event. Bounded transport retries replay
  // that same event with the same key; a new click gets a new key.
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    let transportFailure = false;
    try {
      const response = await fetch(`${NANO_API_BASE}/case-stats`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caseId, requestKey }),
      });
      const envelope = (await response.json().catch(() => null)) as {
        success?: boolean;
        data?: { recorded?: boolean };
        code?: string;
      } | null;
      if (!response.ok || !envelope?.success) {
        throw nanoCodeError(envelope?.code ?? "INTERNAL");
      }
      return envelope.data?.recorded === true;
    } catch (error) {
      const code = toNanoClientError(error).code;
      transportFailure = code === "NETWORK_ERROR" || code === "INTERNAL";
      if (!transportFailure || attempt === 3) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
  }
  throw nanoCodeError("NETWORK_ERROR");
}

function toUiTask(task: NanoTaskDto): UiNanoTask {
  return task as unknown as UiNanoTask;
}

function readLocalValue(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocalValue(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Private browsing is fine: refresh then recovers via bounded history.
  }
}

async function fileToBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

export function NanoStudio({ config }: NanoStudioProps) {
  const t = useTranslations("Landing.Nano.ui");
  const { data: session, isPending: sessionPending } = authClient.useSession();
  const isSignedIn = !!session?.user;
  const sessionUserId = session?.user?.id ?? null;
  const { admit, get, list, cancel, poll } = useNanoTask(NANO_API_BASE);

  const [prompt, setPrompt] = useState("");
  const [selectedCaseId, setSelectedCaseId] = useState<string | undefined>();
  const [upload, setUpload] = useState<UploadState>(EMPTY_UPLOAD);
  const [task, setTask] = useState<UiNanoTask | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [polling, setPolling] = useState(false);
  const [error, setError] = useState<NanoClientError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [caseStats, setCaseStats] = useState<NanoCaseStats>({
    topCases: [],
    stats: {},
  });
  const [historyRefreshToken, setHistoryRefreshToken] = useState(0);
  const [lastSubmission, setLastSubmission] = useState<{
    requestKey: string;
    fingerprint: string;
  } | null>(null);
  const pollControllerRef = useRef<AbortController | null>(null);
  const getControllerRef = useRef<AbortController | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const restoredForUserRef = useRef<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      pollControllerRef.current?.abort();
      getControllerRef.current?.abort();
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    };
  }, []);

  const stableApi = useMemo(
    () => ({
      list: list as (options?: {
        pageSize?: number;
        nextCursor?: string;
        signal?: AbortSignal;
      }) => Promise<NanoTaskListDto>,
      get,
    }),
    [get, list],
  );

  const showError = useCallback((caught: unknown) => {
    if (!mountedRef.current) return;
    setError(toNanoClientError(caught));
    setNotice(null);
  }, []);

  const refreshTask = useCallback(
    async (taskId: string): Promise<UiNanoTask | null> => {
      getControllerRef.current?.abort();
      const controller = new AbortController();
      getControllerRef.current = controller;
      setRefreshing(true);
      try {
        const nextTask = await get(taskId, { signal: controller.signal });
        if (
          controller.signal.aborted ||
          getControllerRef.current !== controller
        ) {
          return null;
        }
        if (!isNanoTask(nextTask)) throw nanoCodeError("INTERNAL");
        const uiTask = toUiTask(nextTask);
        if (mountedRef.current) {
          setTask(uiTask);
          setError(null);
        }
        return uiTask;
      } catch (caught) {
        if (
          !controller.signal.aborted &&
          getControllerRef.current === controller
        ) {
          showError(caught);
        }
        return null;
      } finally {
        if (getControllerRef.current === controller) {
          getControllerRef.current = null;
          if (mountedRef.current) setRefreshing(false);
        }
      }
    },
    [get, showError],
  );

  const watch = useCallback(
    async (taskId: string) => {
      pollControllerRef.current?.abort();
      const controller = new AbortController();
      pollControllerRef.current = controller;
      setPolling(true);
      try {
        const latest = await poll(taskId, { signal: controller.signal });
        if (
          !mountedRef.current ||
          controller.signal.aborted ||
          pollControllerRef.current !== controller
        ) {
          return;
        }
        if (!isNanoTask(latest)) throw nanoCodeError("INTERNAL");
        setTask(toUiTask(latest));
        setError(null);
      } catch (caught) {
        if (
          !controller.signal.aborted &&
          pollControllerRef.current === controller
        ) {
          showError(caught);
        }
      } finally {
        if (pollControllerRef.current === controller) {
          pollControllerRef.current = null;
          if (mountedRef.current) setPolling(false);
        }
      }
    },
    [poll, showError],
  );

  useEffect(() => {
    const controller = new AbortController();
    void readCaseStats(controller.signal)
      .then((stats) => {
        if (!controller.signal.aborted) setCaseStats(stats);
      })
      .catch(() => {
        // Public GET stats are optional presentation; errors must not fake counts.
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (sessionPending || restoredForUserRef.current === sessionUserId) return;
    restoredForUserRef.current = sessionUserId;
    getControllerRef.current?.abort();
    pollControllerRef.current?.abort();
    setTask(null);
    setSelectedTaskId(null);
    setLastSubmission(null);
    setError(null);
    setNotice(null);
    if (!isSignedIn) return;
    const lastTaskId = readLocalValue(NANO_LOCAL_TASK_KEY);
    if (!lastTaskId) return;
    setSelectedTaskId(lastTaskId);
    void refreshTask(lastTaskId).then((restored) => {
      if (
        restored &&
        ["queued", "leased", "dispatching", "running"].includes(restored.status)
      ) {
        void watch(restored.taskId);
      }
    });
  }, [
    isSignedIn,
    refreshTask,
    sessionPending,
    sessionUserId,
    watch,
  ]);

  const loadExampleImage = useCallback(
    async (sourceUrl: string) => {
      const response = await fetch(sourceUrl);
      if (!response.ok) throw nanoCodeError("INVALID_INPUT");
      const blob = await response.blob();
      const mimeType = blob.type;
      if (!config.allowedMimeTypes.includes(mimeType)) {
          throw nanoCodeError("INVALID_INPUT");
      }
      const file = new File([blob], "nano-example", { type: mimeType });
      const dataBase64 = await fileToBase64(file);
      setUpload({
        file,
        mimeType,
        dataBase64,
        bytes: file.size,
        previewUrl: sourceUrl,
        sourceUrl,
      });
    },
    [config.allowedMimeTypes],
  );

  const handleCaseSelect = useCallback(
    async (caseId: string) => {
      if (!isNanoCaseId(caseId)) {
        setError({ status: 400, code: "UNKNOWN_CASE", message: caseId });
        return;
      }
      const item = getNanoCaseById(caseId);
      if (!item) return;

      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
      setSelectedCaseId(caseId);
      setPrompt(item.prompt);
      setError(null);
      setNotice(null);

      // One fresh real selection gets one requestKey. Any bounded transport
      // retry of this event reuses it; stats counts are never made up locally.
      const caseRequestKey = createRequestKey();
      if (config.enabled && isSignedIn) {
        try {
          await recordCaseSelection(caseId, caseRequestKey);
        } catch (caught) {
          showError(caught);
        }
      } else {
        setNotice(t("composer.statsSkipped"));
      }

      const firstInput = item.inputImages[0];
      if (firstInput) {
        try {
          await loadExampleImage(firstInput);
          setNotice(t("composer.caseLoaded"));
        } catch {
          setNotice(t("composer.caseNoImage"));
        }
      } else {
        setUpload(EMPTY_UPLOAD);
        setNotice(t("composer.caseNoImage"));
      }
    },
    [
      config.enabled,
      isSignedIn,
      loadExampleImage,
      showError,
      t,
    ],
  );

  const handleFile = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0] ?? null;
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
      if (!file) {
        setUpload(EMPTY_UPLOAD);
        return;
      }
      try {
        if (!config.allowedMimeTypes.includes(file.type)) {
          throw nanoCodeError("INVALID_INPUT");
        }
        const dataBase64 = await fileToBase64(file);
        const previewUrl = URL.createObjectURL(file);
        objectUrlRef.current = previewUrl;
        setUpload({
          file,
          mimeType: file.type,
          dataBase64,
          bytes: file.size,
          previewUrl,
          sourceUrl: null,
        });
        setError(null);
      } catch (caught) {
        setError(toNanoClientError(caught));
      }
    },
    [config.allowedMimeTypes],
  );

  const submit = useCallback(
    async (replay = false) => {
      setError(null);
      setNotice(null);
      if (!config.enabled) {
        setError({ status: 503, code: "NANO_DISABLED", message: "closed" });
        return;
      }
      if (sessionPending) return;
      if (!isSignedIn) {
        setError({ status: 401, code: "AUTH_REQUIRED", message: "login" });
        return;
      }
      const invalid = validateNanoInput(
        {
          prompt,
          mimeType: upload.mimeType,
          imageBytes: upload.bytes,
          caseId: selectedCaseId,
        },
        config,
      );
      if (invalid) {
        setError({ status: 400, code: invalid, message: invalid });
        return;
      }

      const payloadWithoutKey = {
        prompt,
        image: upload.dataBase64,
        mimeType: upload.mimeType,
        ...(selectedCaseId ? { caseId: selectedCaseId } : {}),
      };
      const fingerprint = nanoInputFingerprint(payloadWithoutKey);
      if (replay && (
        !lastSubmission || lastSubmission.fingerprint !== fingerprint
      )) {
        setError({
          status: 409,
          code: "IDEMPOTENCY_CONFLICT",
          message: "Input changed",
        });
        return;
      }
      // A normal click is a new real request. Explicit replay reuses exactly
      // the original key and payload, so a lost response cannot double-charge.
      const requestKey = replay && lastSubmission
        ? lastSubmission.requestKey
        : createRequestKey();
      setSubmitting(true);
      try {
        const payload: NanoAdmitPayload = {
          ...payloadWithoutKey,
          requestKey,
        };
        const admitted: NanoAdmitResult = await admit(payload);
        if (!admitted?.taskId) throw nanoCodeError("INTERNAL");
        setLastSubmission({ requestKey, fingerprint });
        setSelectedTaskId(admitted.taskId);
        writeLocalValue(NANO_LOCAL_TASK_KEY, admitted.taskId);
        setHistoryRefreshToken((token) => token + 1);
        setNotice(
          admitted.created
            ? t("composer.admitted")
            : t("composer.idempotentReplay"),
        );
        await refreshTask(admitted.taskId);
        await watch(admitted.taskId);
      } catch (caught) {
        showError(caught);
      } finally {
        if (mountedRef.current) setSubmitting(false);
      }
    },
    [
      admit,
      config,
      isSignedIn,
      lastSubmission,
      prompt,
      refreshTask,
      selectedCaseId,
      sessionPending,
      showError,
      t,
      upload,
      watch,
    ],
  );

  const selectHistoryTask = useCallback(
    (item: NanoTaskSummary) => {
      setSelectedTaskId(item.taskId);
      writeLocalValue(NANO_LOCAL_TASK_KEY, item.taskId);
      void refreshTask(item.taskId);
    },
    [refreshTask],
  );

  const cancelTask = useCallback(
    async (taskId: string) => {
      setError(null);
      try {
        await cancel(taskId);
        setNotice(t("composer.canceled"));
        setHistoryRefreshToken((token) => token + 1);
        await refreshTask(taskId);
      } catch (caught) {
        showError(caught);
      }
    },
    [cancel, refreshTask, showError, t],
  );

  const canReplay =
    lastSubmission !== null &&
    lastSubmission.fingerprint ===
      nanoInputFingerprint({
        prompt,
        image: upload.dataBase64,
        mimeType: upload.mimeType,
        ...(selectedCaseId ? { caseId: selectedCaseId } : {}),
      });

  const errorKey = error
    ? NANO_ERROR_CODES.includes(
        error.code as (typeof NANO_ERROR_CODES)[number],
      )
      ? `errors.${error.code}`
      : "errors.UNKNOWN"
    : null;
  const isKnownPollStop =
    task !== null &&
    ["succeeded", "failed", "canceled", "unknown"].includes(task.status);

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>{t("composer.title")}</CardTitle>
            <CardDescription>{t("composer.description")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!config.enabled && (
              <Alert>
                <AlertTitle>{t("status.closedTitle")}</AlertTitle>
                <AlertDescription>{t("status.closedBody")}</AlertDescription>
              </Alert>
            )}

            {!sessionPending && !isSignedIn && (
              <Alert>
                <AlertTitle>{t("status.loginTitle")}</AlertTitle>
                <AlertDescription className="space-y-3">
                  {t("status.loginBody")}
                  <LoginButton />
                </AlertDescription>
              </Alert>
            )}

            {error && errorKey && (
              <Alert variant="destructive" role="alert">
                <AlertTitle>{t("composer.errorTitle")}</AlertTitle>
                <AlertDescription>
                  {t(errorKey)}
                  <span className="mt-1 block font-mono text-xs opacity-70">
                    {error.code} · {error.status}
                  </span>
                </AlertDescription>
              </Alert>
            )}
            {notice && (
              <Alert role="status">
                <AlertDescription>{notice}</AlertDescription>
              </Alert>
            )}

            <div className="space-y-2">
              <Label htmlFor="nano-image">{t("composer.image")}</Label>
              <Input
                id="nano-image"
                type="file"
                accept={config.allowedMimeTypes.join(",")}
                onChange={handleFile}
                disabled={!config.enabled || !isSignedIn}
              />
              <p className="text-muted-foreground text-xs">
                {t("composer.limits", {
                  size: Math.floor(config.maxImageBytes / 1024 / 1024),
                  types: config.allowedMimeTypes.join(" / "),
                  cost: config.cost,
                })}
              </p>
              {upload.previewUrl && (
                <div className="bg-muted relative aspect-video max-w-sm overflow-hidden rounded-md">
                  <NanoImage
                    src={upload.previewUrl}
                    alt={t("composer.previewAlt")}
                    className="h-full w-full object-contain"
                  />
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="nano-prompt">{t("composer.prompt")}</Label>
              <Textarea
                id="nano-prompt"
                value={prompt}
                maxLength={config.maxPromptChars}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder={t("composer.promptPlaceholder")}
                rows={5}
                disabled={!config.enabled || !isSignedIn}
              />
              <p className="text-muted-foreground text-xs">
                {t("composer.chars", {
                  count: prompt.length,
                  max: config.maxPromptChars,
                })}
              </p>
            </div>

            {selectedCaseId && (
              <p className="text-muted-foreground text-xs">
                {t("composer.selectedCase", { id: selectedCaseId })}
              </p>
            )}

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                disabled={
                  !config.enabled ||
                  !isSignedIn ||
                  sessionPending ||
                  submitting ||
                  polling
                }
                onClick={() => void submit(false)}
              >
                {submitting || polling
                  ? t("composer.working")
                  : t("composer.submit")}
              </Button>
              {canReplay && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={
                    !config.enabled ||
                    !isSignedIn ||
                    submitting ||
                    polling
                  }
                  onClick={() => void submit(true)}
                >
                  {t("composer.replay")}
                </Button>
              )}
              {task && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={refreshing}
                  onClick={() => void refreshTask(task.taskId)}
                >
                  {refreshing ? t("composer.working") : t("composer.refresh")}
                </Button>
              )}
              {task?.status === "unknown" && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={refreshing}
                  onClick={() => void refreshTask(task.taskId)}
                >
                  {t("composer.manualConfirm")}
                </Button>
              )}
              {task?.status === "queued" && (
                <Button
                  type="button"
                  variant="destructive"
                  onClick={() => void cancelTask(task.taskId)}
                >
                  {t("composer.cancel")}
                </Button>
              )}
            </div>

            {polling && !isKnownPollStop && (
              <p role="status" className="text-muted-foreground text-sm">
                {t("composer.polling")}
              </p>
            )}
            {task?.status === "unknown" && (
              <p className="text-muted-foreground text-sm">
                {t("status.unknownBody")}
              </p>
            )}
          </CardContent>
        </Card>

        <NanoResultPanel task={task} />
        <NanoCaseGallery
          selectedCaseId={selectedCaseId}
          topCases={caseStats.topCases}
          disabled={!config.enabled || !isSignedIn || submitting}
          onSelect={(caseId) => void handleCaseSelect(caseId)}
        />
      </div>

      <div className="space-y-6">
        <NanoTaskHistory
          api={stableApi}
          selectedTaskId={selectedTaskId}
          disabled={!isSignedIn || submitting}
          canRead={!sessionPending && isSignedIn}
          sessionUserId={sessionUserId}
          onSelect={selectHistoryTask}
          onCancel={(taskId) => void cancelTask(taskId)}
          onRefresh={() => {
            if (task) void refreshTask(task.taskId);
          }}
          onError={showError}
          refreshToken={historyRefreshToken}
        />
      </div>
    </div>
  );
}
