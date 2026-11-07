/**
 * `@sunpcm/niu-feature-nano` root entry.
 *
 * Core contracts and pure usecases only. The Google provider and React client
 * hook live in explicit subpaths and are NOT re-exported here, so importing the
 * root never drags in `@google/genai` or `react`, and never reads `process.env`.
 */
export {
  ACTIVE_NANO_STATUSES,
  TERMINAL_NANO_STATUSES,
  admitTask,
  cancelTask,
  completeTask,
  dispatchDecision,
  failTask,
  isActive,
  isTerminal,
  markUnknown,
  nanoSubjectKey,
  type DispatchDecision,
  type NanoAdmitInput,
  type NanoAdmitResult,
  type NanoCase,
  type NanoCaseCatalog,
  type NanoClaim,
  type NanoInputRef,
  type NanoSubject,
  type NanoTask,
  type NanoTaskRepository,
  type NanoTaskStatus,
  type NanoUnit,
} from "./core.js";
export { createCaseCatalog } from "./case-catalog.js";
export {
  NanoProviderError,
  type NanoProvider,
  type NanoProviderRequest,
  type NanoProviderResult,
} from "./provider.js";
export {
  NanoError,
  NanoIdempotencyConflictError,
  NanoInsufficientCreditsError,
  NanoInvalidInputError,
  NanoInvalidStateError,
  NanoTaskNotFoundError,
  NanoUnknownCaseError,
  type NanoErrorCode,
} from "./errors.js";
