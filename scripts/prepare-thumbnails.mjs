import {
  Client,
  collectPaginatedAPI,
  extractDatabaseId,
  isFullDatabase,
  isFullPage,
} from "@notionhq/client";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

async function loadDotEnv() {
  try {
    const envPath = path.join(process.cwd(), ".env");
    const raw = await fs.readFile(envPath, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }
      const sep = trimmed.indexOf("=");
      if (sep === -1) {
        continue;
      }
      const key = trimmed.slice(0, sep).trim();
      const value = trimmed.slice(sep + 1).trim().replace(/^['"]|['"]$/g, "");
      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  } catch {
    // Ignore when .env is not present.
  }
}

function getEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set`);
  }
  return value;
}

function normalizeDatabaseId(input) {
  return extractDatabaseId(input) ?? input;
}

function sanitizeFileKey(fileKey) {
  return fileKey.replace(/[^a-zA-Z0-9-_]/g, "-");
}

function getThumbnailUrl(property) {
  if (!property || property.type !== "files") {
    return undefined;
  }
  const first = property.files[0];
  if (!first) {
    return undefined;
  }
  if (first.type === "external") {
    return first.external.url;
  }
  return first.file.url;
}

async function resolveDataSourceId(notion, databaseId) {
  const database = await notion.databases.retrieve({
    database_id: normalizeDatabaseId(databaseId),
  });

  if (!isFullDatabase(database)) {
    throw new Error("Failed to retrieve full database object.");
  }

  const defaultDataSource = database.data_sources[0];
  if (!defaultDataSource) {
    throw new Error("No data source found in the specified database.");
  }

  return defaultDataSource.id;
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  await loadDotEnv();
  const notionApiKey = getEnv("NOTION_API_KEY");
  const notionDatabaseId = getEnv("NOTION_DATABASE_ID");

  const notion = new Client({ auth: notionApiKey });
  const dataSourceId = await resolveDataSourceId(notion, notionDatabaseId);

  const results = await collectPaginatedAPI(
    (args) => notion.dataSources.query(args),
    {
      data_source_id: dataSourceId,
      filter: {
        property: "Status",
        status: { equals: "Published" },
      },
      sorts: [{ property: "Date", direction: "descending" }],
      page_size: 100,
    },
  );

  const imageDir = path.join(process.cwd(), "public", "images", "thumbnails");
  await fs.mkdir(imageDir, { recursive: true });

  let generated = 0;
  let skipped = 0;
  let failed = 0;

  for (const page of results.filter(isFullPage)) {
    const thumbnailUrl = getThumbnailUrl(page.properties.Thumbnail);
    if (!thumbnailUrl) {
      continue;
    }

    const fileName = `${sanitizeFileKey(`thumb-${page.id}`)}.webp`;
    const destination = path.join(imageDir, fileName);

    if (await fileExists(destination)) {
      skipped += 1;
      continue;
    }

    try {
      const response = await fetch(thumbnailUrl);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }

      const sourceData = new Uint8Array(await response.arrayBuffer());
      await sharp(sourceData)
        .resize({ width: 880, height: 560, fit: "cover", withoutEnlargement: true })
        .webp({ quality: 86 })
        .toFile(destination);

      generated += 1;
    } catch (error) {
      failed += 1;
      console.warn(`[prepare-thumbnails] Failed for page ${page.id}:`, error);
    }
  }

  console.log(
    `[prepare-thumbnails] done. generated=${generated}, skipped=${skipped}, failed=${failed}`,
  );
}

main().catch((error) => {
  console.error("[prepare-thumbnails] fatal error:", error);
  process.exitCode = 1;
});
