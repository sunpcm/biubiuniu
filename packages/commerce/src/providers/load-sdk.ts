export async function loadOptionalSdk(specifier: string, provider: string): Promise<Record<string, unknown>> {
  try {
    return await import(specifier) as Record<string, unknown>;
  } catch {
    throw new Error(`${provider} provider is enabled but the optional peer dependency "${specifier}" is not installed`);
  }
}
