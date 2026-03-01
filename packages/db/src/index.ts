import { createDatabase } from "./config";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.log("DATABASE_URL is not set");
}

export const db = createDatabase({
  connectionString: connectionString || "",
});

export const isDatabaseEnabled = !!connectionString;

export { createDatabase, createDatabaseConfig, previewConfig } from "./config";
export * from "./schema";
