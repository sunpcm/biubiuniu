/**
 * Unified logger: Pino (structured logging) + Sentry (error reporting)
 *
 * - Development: pretty-printed colored output via pino-pretty
 * - Production stdout: JSON output (captured by cloud platform log aggregators)
 * - Production with LOG_DIR set: adds file rotation via pino-roll
 * - Edge runtime: JSON to stdout only (no worker threads / file system)
 *
 * Sentry integration:
 * - warn: adds breadcrumb
 * - error / fatal: captures exception and reports to Sentry
 *
 * Privacy:
 * - every structured payload and message passes through logger/privacy before
 *   Pino or Sentry sees it;
 * - the raw Pino instance is intentionally not exposed, so callers cannot
 *   bypass that boundary.
 */

// Sentry is initialized via instrumentation.ts + sentry.*.config.ts
// All calls here are no-ops if NEXT_PUBLIC_SENTRY_DSN is not configured
import * as Sentry from "@sentry/nextjs";
import path from "node:path";
import pino, { type Logger } from "pino";
import { findNestedError, sanitizeLogData, sanitizeLogError, sanitizeLogText } from "./privacy";
import { buildBaseLoggerOptions } from "./options";

const IS_DEV = process.env.NODE_ENV === "development";
const IS_EDGE = process.env.NEXT_RUNTIME === "edge";
const LOG_DIR = process.env.LOG_DIR;

function createPinoLogger(name: string): Logger {
  const options = buildBaseLoggerOptions(name);

  // Edge runtime: no worker threads, just plain JSON stdout
  if (IS_EDGE) {
    return pino(options);
  }

  // Development: pretty-printed console output
  if (IS_DEV) {
    const transport = pino.transport({
      target: "pino-pretty",
      options: {
        colorize: true,
        translateTime: "HH:MM:ss",
        ignore: "pid,hostname",
      },
    });
    return pino(options, transport);
  }

  // Production Node.js: JSON stdout by default; add file rotation if LOG_DIR is set
  if (LOG_DIR) {
    const targets: pino.TransportTargetOptions[] = [
      {
        target: "pino-roll",
        options: {
          file: path.join(LOG_DIR, name),
          frequency: "daily",
          size: parseInt(process.env.LOG_MAX_SIZE ?? String(10 * 1024 * 1024), 10),
          mkdir: true,
          extension: ".log",
          dateFormat: "yyyy-MM-dd",
        },
        level: options.level,
      },
    ];
    const transport = pino.transport({ targets });
    return pino(options, transport);
  }

  // Default production: JSON to stdout
  return pino(options);
}

export interface AppLogger {
  trace(obj: object, msg?: string): void;
  debug(obj: object, msg?: string): void;
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(err: Error | object, msg?: string): void;
  fatal(err: Error | object, msg?: string): void;
  /** Manually capture an error with extra context */
  captureError(error: Error, context?: Record<string, unknown>): void;
}

interface LoggerSentrySink {
  addBreadcrumb(breadcrumb: {
    category: string;
    message: string;
    level: "warning";
    data: Record<string, unknown>;
  }): void;
  captureException(
    error: Error,
    context: {
      level?: "error" | "fatal";
      tags: Record<string, string>;
      extra: Record<string, unknown>;
    },
  ): unknown;
  captureMessage(
    message: string,
    context: {
      level: "error" | "fatal";
      tags: Record<string, string>;
      extra: Record<string, unknown>;
    },
  ): unknown;
}

export interface LoggerSinks {
  /** Test/embedding seam; production uses the configured Pino transport. */
  pino?: Logger;
  /** Test/embedding seam; production uses the initialized Sentry SDK. */
  sentry?: LoggerSentrySink;
}

export function createLogger(name: string, sinks: LoggerSinks = {}): AppLogger {
  const logger = sinks.pino ?? createPinoLogger(name);
  const sentry = sinks.sentry ?? (Sentry as LoggerSentrySink);

  const appLogger: AppLogger = {
    trace: (obj, msg) => logger.trace(sanitizeLogData(obj), sanitizeLogText(msg ?? "")),
    debug: (obj, msg) => logger.debug(sanitizeLogData(obj), sanitizeLogText(msg ?? "")),
    info: (obj, msg) => logger.info(sanitizeLogData(obj), sanitizeLogText(msg ?? "")),

    warn: (obj, msg) => {
      const safeData = sanitizeLogData(obj);
      const safeMessage = sanitizeLogText(msg ?? "Warning");
      logger.warn(safeData, safeMessage);
      sentry.addBreadcrumb({
        category: name,
        message: safeMessage,
        level: "warning",
        data: safeData,
      });
    },

    error: (errOrObj, msg) => {
      if (errOrObj instanceof Error) {
        const safeError = sanitizeLogError(errOrObj);
        const safeMessage = sanitizeLogText(msg ?? errOrObj.message);
        logger.error({ err: safeError }, safeMessage);
        sentry.captureException(safeError, {
          level: "error",
          tags: { logger: name },
          extra: { message: safeMessage },
        });
      } else {
        const safeData = sanitizeLogData(errOrObj);
        const safeMessage = sanitizeLogText(msg ?? "Error");
        logger.error(safeData, safeMessage);
        const nested = findNestedError(errOrObj);
        if (nested) {
          const safeError = sanitizeLogError(nested);
          sentry.captureException(safeError, {
            level: "error",
            tags: { logger: name },
            extra: safeData,
          });
        } else {
          sentry.captureMessage(safeMessage, {
            level: "error",
            tags: { logger: name },
            extra: safeData,
          });
        }
      }
    },

    fatal: (errOrObj, msg) => {
      if (errOrObj instanceof Error) {
        const safeError = sanitizeLogError(errOrObj);
        const safeMessage = sanitizeLogText(msg ?? errOrObj.message);
        logger.fatal({ err: safeError }, safeMessage);
        sentry.captureException(safeError, {
          level: "fatal",
          tags: { logger: name },
          extra: { message: safeMessage },
        });
      } else {
        const safeData = sanitizeLogData(errOrObj);
        const safeMessage = sanitizeLogText(msg ?? "Fatal error");
        logger.fatal(safeData, safeMessage);
        sentry.captureMessage(safeMessage, {
          level: "fatal",
          tags: { logger: name },
          extra: safeData,
        });
      }
    },

    captureError: (error, context) => {
      const safeError = sanitizeLogError(error);
      const safeContext = sanitizeLogData(context ?? {});
      const safeMessage = sanitizeLogText(error.message);
      logger.error({ ...safeContext, err: safeError }, safeMessage);
      sentry.captureException(safeError, {
        level: "error",
        tags: { logger: name },
        extra: safeContext,
      });
    },
  };

  return appLogger;
}

const loggerCache = new Map<string, AppLogger>();

/** Get or create a cached logger by name */
export function getLogger(name: string): AppLogger {
  if (!loggerCache.has(name)) {
    loggerCache.set(name, createLogger(name));
  }
  return loggerCache.get(name)!;
}
