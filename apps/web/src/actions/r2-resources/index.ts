"use server";

import { actionResponse } from "@/lib/action-response";
import { getSession, isAdmin } from "@/lib/auth/server";
import {
  createPresignedDownloadUrl,
  createPresignedUploadUrl,
  deleteFile,
  ListedObject,
  listR2Objects
} from "@/lib/cloudflare/r2";
import { generateR2Key } from "@/lib/cloudflare/r2-utils";
import { getLogger } from "@/lib/logger";
import { checkRateLimit, getClientIPFromHeaders, RATE_LIMIT_CONFIGS } from "@/lib/redis";
import {
  evaluateDownloadPolicy,
  evaluateUploadPolicy,
  normalizeFilenamePart,
  type R2AccessPrincipal,
} from "@/lib/storage/object-policy";
import { z } from "zod";

const PRESIGNED_UPLOAD_EXPIRES_IN = 300; // 10 minutes
const PRESIGNED_DOWNLOAD_EXPIRES_IN = 300; // 5 minutes
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

const logger = getLogger("actions.r2-resources");

export type R2File = ListedObject;

export interface ListR2FilesData {
  success: boolean;
  data?: {
    files: R2File[];
    nextContinuationToken?: string;
  };
  error?: string;
}

const listSchema = z.object({
  categoryPrefix: z.string(),
  filterPrefix: z.string().optional(),
  continuationToken: z.string().optional(),
  pageSize: z.number().int().positive().max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});

export async function listR2Files(
  input: z.infer<typeof listSchema>
): Promise<ListR2FilesData> {
  if (!(await isAdmin())) {
    return actionResponse.forbidden("Admin privileges required.");
  }

  const validationResult = listSchema.safeParse(input);
  if (!validationResult.success) {
    const formattedErrors = validationResult.error.flatten().fieldErrors;
    return actionResponse.badRequest(`Invalid input: ${JSON.stringify(formattedErrors)}`);
  }

  const { categoryPrefix, filterPrefix, continuationToken, pageSize } = validationResult.data;

  const searchPrefix = filterPrefix ? `${categoryPrefix}${filterPrefix}` : categoryPrefix;

  try {
    const result = await listR2Objects({
      prefix: searchPrefix,
      continuationToken: continuationToken,
      pageSize: pageSize,
    });

    if (result.error) {
      return actionResponse.error(result.error);
    }

    return actionResponse.success({
      files: result.objects,
      nextContinuationToken: result.nextContinuationToken,
    });
  } catch (error) {
    logger.error(
      error instanceof Error ? error : new Error(String(error)),
      "Failed to list files using generic R2 lister",
    );
    return actionResponse.error("Failed to list files.");
  }
}

export interface DeleteR2FileData {
  success: boolean;
  error?: string;
}

export async function deleteR2File(key: string): Promise<DeleteR2FileData> {
  if (!(await isAdmin())) {
    return actionResponse.forbidden("Admin privileges required.");
  }

  if (!key || key.trim() === "") {
    return actionResponse.badRequest("File key cannot be empty");
  }

  try {
    await deleteFile(key.trim());
    return actionResponse.success();
  } catch (error) {
    logger.error(
      error instanceof Error ? error : new Error(String(error)),
      `Failed to delete R2 file`,
    );
    return actionResponse.error("Failed to delete file from R2.");
  }
}

export interface GeneratePresignedUploadUrlData {
  success: boolean;
  data?: {
    presignedUrl: string;
    key: string;
    publicObjectUrl: string;
  };
  error?: string;
}
const generatePresignedUrlSchema = z.object({
  fileName: z.string().min(1, "File name cannot be empty"),
  contentType: z.string().min(1, "Content type cannot be empty"),
  prefix: z.string().optional(),
  path: z.string(),
});
type GeneratePresignedUploadUrlInput = z.infer<
  typeof generatePresignedUrlSchema
>;

async function generatePresignedUploadUrl(
  input: GeneratePresignedUploadUrlInput,
  principal: R2AccessPrincipal,
  userId: string | null,
): Promise<GeneratePresignedUploadUrlData> {
  const validationResult = generatePresignedUrlSchema.safeParse(input);
  if (!validationResult.success) {
    const formattedErrors = validationResult.error.flatten().fieldErrors;
    return actionResponse.badRequest(
      `Invalid input: ${JSON.stringify(formattedErrors)}`
    );
  }

  const { fileName, contentType, path, prefix } = validationResult.data;

  const normalizedFileName = normalizeFilenamePart(fileName);
  if (!normalizedFileName) {
    return actionResponse.badRequest("File name cannot contain path segments.");
  }

  const policy = evaluateUploadPolicy(principal, userId, path, prefix);
  if (!policy.allowed) {
    return policy.reason === "forbidden"
      ? actionResponse.forbidden("Access denied.")
      : actionResponse.badRequest("Invalid upload path.");
  }

  try {
    const objectKey = generateR2Key({
      fileName: normalizedFileName,
      path: policy.normalizedPath!,
      prefix: policy.normalizedPrefix,
    });

    const { presignedUrl, publicObjectUrl } = await createPresignedUploadUrl({
      key: objectKey,
      contentType,
      expiresIn: PRESIGNED_UPLOAD_EXPIRES_IN,
    });

    return actionResponse.success({
      presignedUrl,
      key: objectKey,
      publicObjectUrl,
    });
  } catch (error) {
    logger.error(
      error instanceof Error ? error : new Error(String(error)),
      "Failed to generate pre-signed upload URL",
    );
    return actionResponse.error("Failed to generate upload URL.");
  }
}

export async function generateAdminPresignedUploadUrl(
  input: GeneratePresignedUploadUrlInput
): Promise<GeneratePresignedUploadUrlData> {
  if (!(await isAdmin())) {
    return actionResponse.forbidden("Admin privileges required.");
  }
  return generatePresignedUploadUrl(input, "admin", null);
}

export async function generateUserPresignedUploadUrl(
  input: GeneratePresignedUploadUrlInput
): Promise<GeneratePresignedUploadUrlData> {
  const session = await getSession()
  const user = session?.user;
  if (!user) return actionResponse.unauthorized();

  return generatePresignedUploadUrl(input, "user", user.id);
}

export async function generatePublicPresignedUploadUrl(
  input: GeneratePresignedUploadUrlInput
): Promise<GeneratePresignedUploadUrlData> {
  const clientIP = await getClientIPFromHeaders();
  const isAllowed = await checkRateLimit(clientIP, RATE_LIMIT_CONFIGS.anonymousUpload);

  if (!isAllowed) {
    return actionResponse.badRequest(`Rate limit exceeded. Anonymous users can upload up to ${RATE_LIMIT_CONFIGS.anonymousUpload.maxRequests} images per day.`);
  }

  return generatePresignedUploadUrl(input, "public", null);
}


export interface GeneratePresignedDownloadUrlData {
  success: boolean;
  data?: {
    presignedUrl: string;
  };
  error?: string;
}

async function generatePresignedDownloadUrl(
  key: string,
  principal: R2AccessPrincipal,
  userId: string | null,
): Promise<GeneratePresignedDownloadUrlData> {
  const trimmedKey = key.trim();
  if (!trimmedKey) {
    return actionResponse.badRequest("File key cannot be empty");
  }

  if (!evaluateDownloadPolicy(principal, userId, trimmedKey)) {
    return actionResponse.forbidden("Access denied.");
  }

  try {
    const presignedUrl = await createPresignedDownloadUrl({
      key: trimmedKey,
      expiresIn: PRESIGNED_DOWNLOAD_EXPIRES_IN,
    });

    return actionResponse.success({ presignedUrl });
  } catch (error) {
    logger.error(
      error instanceof Error ? error : new Error(String(error)),
      "Failed to generate pre-signed download URL",
    );
    return actionResponse.error("Failed to generate download URL.");
  }
}

export async function generateAdminPresignedDownloadUrl(
  key: string
): Promise<GeneratePresignedDownloadUrlData> {
  if (!(await isAdmin())) {
    return actionResponse.forbidden("Admin privileges required.");
  }
  return generatePresignedDownloadUrl(key, "admin", null);
}

export async function generateUserPresignedDownloadUrl(
  key: string
): Promise<GeneratePresignedDownloadUrlData> {
  const session = await getSession();
  const user = session?.user;

  if (!user) {
    return actionResponse.unauthorized();
  }

  return generatePresignedDownloadUrl(key, "user", user.id);
}

export async function generatePublicPresignedDownloadUrl(
  key: string
): Promise<GeneratePresignedDownloadUrlData> {
  const clientIP = await getClientIPFromHeaders();
  const isAllowed = await checkRateLimit(clientIP, RATE_LIMIT_CONFIGS.anonymousDownload);

  if (!isAllowed) {
    return actionResponse.badRequest(`Rate limit exceeded. Anonymous users can download up to ${RATE_LIMIT_CONFIGS.anonymousDownload.maxRequests} images per day.`);
  }
  return generatePresignedDownloadUrl(key, "public", null);
}
