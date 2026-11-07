import { runMigrations } from "../src/lib/db/migration-runner";

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set");
    process.exitCode = 1;
    return;
  }

  try {
    const report = await runMigrations({ url });

    const checksums = report.files.map((file) => ({
      name: file.name,
      checksum: file.checksum,
      rawChecksum: file.rawChecksum,
    }));

    process.stdout.write(
      `${JSON.stringify({ ...report, files: checksums }, null, 2)}\n`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

void main();
