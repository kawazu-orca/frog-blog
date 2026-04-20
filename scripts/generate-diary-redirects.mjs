import { Client, collectPaginatedAPI, extractDatabaseId, isFullDatabase, isFullPage } from "@notionhq/client";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

async function loadDotEnv() {
	const envPath = path.join(process.cwd(), ".env");
	let content = "";
	try {
		content = await readFile(envPath, "utf8");
	} catch {
		return;
	}

	for (const line of content.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
			continue;
		}
		const [key, ...valueParts] = trimmed.split("=");
		if (!key || process.env[key]) {
			continue;
		}
		process.env[key] = valueParts.join("=").replace(/^["']|["']$/g, "");
	}
}

function getRequiredEnv(name) {
	const value = process.env[name];
	if (!value) {
		throw new Error(`${name} is not set.`);
	}
	return value;
}

function normalizeDatabaseId(input) {
	return extractDatabaseId(input) ?? input;
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

function getPlainText(property) {
	if (!property) {
		return "";
	}
	if (property.type === "title") {
		return property.title.map((item) => item.plain_text).join("");
	}
	if (property.type === "rich_text") {
		return property.rich_text.map((item) => item.plain_text).join("");
	}
	return "";
}

function getDateValue(property) {
	if (!property || property.type !== "date") {
		return null;
	}
	return property.date?.start ?? null;
}

function getSelectValue(property) {
	if (!property || property.type !== "select") {
		return undefined;
	}
	return property.select?.name ?? undefined;
}

function getPostType(property) {
	return getSelectValue(property) === "Diary" ? "Diary" : "Article";
}

function formatDateYmd(date) {
	if (!date) {
		return null;
	}
	const ymd = date.slice(0, 10);
	return /^\d{4}-\d{2}-\d{2}$/.test(ymd) ? ymd : null;
}

function resolveDiarySlug(post) {
	const explicitSlug = post.sourceSlug.trim();
	if (explicitSlug) {
		return explicitSlug;
	}
	return formatDateYmd(post.date) ?? post.pageId;
}

function assertUniqueDiarySlugs(posts) {
	const slugToPageIds = new Map();
	for (const post of posts) {
		const slug = resolveDiarySlug(post);
		const pageIds = slugToPageIds.get(slug) ?? [];
		pageIds.push(post.pageId);
		slugToPageIds.set(slug, pageIds);
	}

	const duplicates = [...slugToPageIds.entries()].filter(
		([, pageIds]) => pageIds.length > 1,
	);
	if (duplicates.length === 0) {
		return;
	}

	const details = duplicates
		.map(([slug, pageIds]) => `${slug}: ${pageIds.join(", ")}`)
		.join("; ");
	throw new Error(`Duplicate diary slugs found. Set explicit Slug values in Notion. ${details}`);
}

async function getPublishedPosts() {
	const notion = new Client({ auth: getRequiredEnv("NOTION_API_KEY") });
	const databaseId = getRequiredEnv("NOTION_DATABASE_ID");
	const dataSourceId = await resolveDataSourceId(notion, databaseId);
	const results = await collectPaginatedAPI(
		(args) => notion.dataSources.query(args),
		{
			data_source_id: dataSourceId,
			filter: {
				property: "Status",
				status: {
					equals: "Published",
				},
			},
			sorts: [
				{
					property: "Date",
					direction: "descending",
				},
			],
			page_size: 100,
		},
	);

	return results.filter(isFullPage).map((page) => {
		const sourceSlug = getPlainText(page.properties.Slug);
		return {
			pageId: page.id,
			type: getPostType(page.properties.Type),
			sourceSlug,
			slug: sourceSlug || page.id,
			date: getDateValue(page.properties.Date),
		};
	});
}

await loadDotEnv();

const posts = await getPublishedPosts();
const diaryPosts = posts.filter((post) => post.type === "Diary");
assertUniqueDiarySlugs(diaryPosts);

const diaryRedirects = Object.fromEntries(
	diaryPosts.map((post) => [
		`/posts/${post.slug}`,
		`/diary/${resolveDiarySlug(post)}/`,
	]),
);

const redirects = Object.entries(diaryRedirects);

const outputPath = path.join(process.cwd(), "public", "_redirects");
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(
	outputPath,
	`${redirects.map(([from, to]) => `${from}    ${to}    301`).join("\n")}\n`,
);

console.log(
	`[generate-diary-redirects] wrote ${redirects.length} diary redirects to ${outputPath}`,
);
