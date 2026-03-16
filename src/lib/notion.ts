import {
	APIResponseError,
	Client,
	collectPaginatedAPI,
	extractDatabaseId,
	isFullBlock,
	isFullDatabase,
	isFullPage,
	type BlockObjectResponse,
	type PageObjectResponse,
} from "@notionhq/client";

export interface PublishedPost {
	pageId: string;
	title: string;
	slug: string;
	date: string | null;
	tags: string[];
	description: string;
}

export type NotionBlockWithChildren = BlockObjectResponse & {
	children?: NotionBlockWithChildren[];
	localImageSrc?: string;
};

function getRequiredEnv(name: "NOTION_API_KEY" | "NOTION_DATABASE_ID"): string {
	const value = import.meta.env[name] ?? process.env[name];

	if (!value) {
		throw new Error(`${name} is not set in .env`);
	}

	return value;
}

function createNotionClient(): { notion: Client; databaseId: string } {
	const notionApiKey = getRequiredEnv("NOTION_API_KEY");
	const databaseId = getRequiredEnv("NOTION_DATABASE_ID");

	return {
		notion: new Client({ auth: notionApiKey }),
		databaseId,
	};
}

function normalizeDatabaseId(input: string): string {
	return extractDatabaseId(input) ?? input;
}

async function resolveDataSourceId(
	notion: Client,
	databaseId: string,
): Promise<string> {
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

function getPlainText(property: PageObjectResponse["properties"][string]): string {
	if (property.type === "title") {
		return property.title.map((item) => item.plain_text).join("");
	}

	if (property.type === "rich_text") {
		return property.rich_text.map((item) => item.plain_text).join("");
	}

	return "";
}

function getDateValue(
	property: PageObjectResponse["properties"][string],
): string | null {
	if (property.type !== "date") {
		return null;
	}

	return property.date?.start ?? null;
}

function getTagNames(property: PageObjectResponse["properties"][string]): string[] {
	if (property.type !== "multi_select") {
		return [];
	}

	return property.multi_select.map((tag) => tag.name);
}

function mapPageToPublishedPost(page: PageObjectResponse): PublishedPost {
	const title = getPlainText(page.properties.Title);
	const slug = getPlainText(page.properties.Slug);
	const date = getDateValue(page.properties.Date);
	const tags = getTagNames(page.properties.Tags);
	const description = getPlainText(page.properties.Description);

	return {
		pageId: page.id,
		title: title || "Untitled",
		slug: slug || page.id,
		date,
		tags,
		description,
	};
}

function toErrorMessage(action: string, error: unknown): string {
	if (APIResponseError.isAPIResponseError(error)) {
		return `${action} failed: [${error.code}] ${error.message}`;
	}

	if (error instanceof Error) {
		return `${action} failed: ${error.message}`;
	}

	return `${action} failed due to an unknown error.`;
}

async function fetchChildBlocks(
	notion: Client,
	blockId: string,
): Promise<NotionBlockWithChildren[]> {
	const results = await collectPaginatedAPI(
		(args) => notion.blocks.children.list(args),
		{
		block_id: blockId,
		page_size: 100,
		},
	);

	const blocks = results.filter(isFullBlock);

	return Promise.all(
		blocks.map(async (block) => {
			let currentBlock: NotionBlockWithChildren = block;

			if (block.type === "image") {
				currentBlock = await processImageBlock(block);
			}

			if (!block.has_children) {
				return currentBlock;
			}

			const children = await fetchChildBlocks(notion, block.id);
			return { ...currentBlock, children };
		}),
	);
}

function getImageUrl(block: Extract<BlockObjectResponse, { type: "image" }>): string {
	return block.image.type === "external" ? block.image.external.url : block.image.file.url;
}

function isNotionSignedImageUrl(url: string): boolean {
	return url.includes("secure.notion-static.com");
}

function getExtensionFromUrl(url: string): string {
	try {
		const pathname = new URL(url).pathname;
		const lastDotIndex = pathname.lastIndexOf(".");
		const slashIndex = pathname.lastIndexOf("/");
		const extension =
			lastDotIndex > slashIndex ? pathname.slice(lastDotIndex).toLowerCase() : "";
		if (extension) {
			return extension;
		}
	} catch {
		// Ignore parse errors and fall back to .bin.
	}

	return ".bin";
}

async function ensureImageDownloaded(
	imageUrl: string,
	filename: string,
): Promise<string> {
	if (process.env.CI) {
		throw new Error("Skip local image cache in CI.");
	}

	let access: (path: string) => Promise<void>;
	let mkdir: (
		path: string,
		options?: { recursive?: boolean },
	) => Promise<string | undefined>;
	let writeFile: (
		file: string,
		data: ArrayBufferView | ArrayBuffer | string,
	) => Promise<void>;
	let join: (...paths: string[]) => string;

	try {
		const fsModule = `node:${"fs/promises"}`;
		const pathModule = `node:${"path"}`;
		const fs = await import(fsModule);
		const path = await import(pathModule);
		access = fs.access;
		mkdir = fs.mkdir;
		writeFile = fs.writeFile;
		join = path.join;
	} catch {
		throw new Error("Node filesystem modules are unavailable.");
	}

	const imageDir = join(process.cwd(), "public", "images");
	await mkdir(imageDir, { recursive: true });

	const destination = join(imageDir, filename);

	try {
		await access(destination);
		return `/images/${filename}`;
	} catch {
		// Continue to download when the file does not exist.
	}

	const response = await fetch(imageUrl);
	if (!response.ok) {
		throw new Error(`Failed to download image: ${response.status} ${response.statusText}`);
	}

	const fileData = new Uint8Array(await response.arrayBuffer());
	await writeFile(destination, fileData);

	return `/images/${filename}`;
}

async function processImageBlock(
	block: Extract<BlockObjectResponse, { type: "image" }>,
): Promise<NotionBlockWithChildren> {
	const imageUrl = getImageUrl(block);
	if (!isNotionSignedImageUrl(imageUrl)) {
		return block;
	}

	try {
		const extension = getExtensionFromUrl(imageUrl);
		const fileName = `${block.id}${extension}`;
		const localImageSrc = await ensureImageDownloaded(imageUrl, fileName);
		return { ...block, localImageSrc };
	} catch {
		return block;
	}
}

export async function getPublishedPosts(): Promise<PublishedPost[]> {
	try {
		const { notion, databaseId } = createNotionClient();
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

		return results
			.filter(isFullPage)
			.map(mapPageToPublishedPost)
			.sort((a, b) => {
				if (a.date === b.date) {
					return 0;
				}

				if (!a.date) {
					return 1;
				}

				if (!b.date) {
					return -1;
				}

				return b.date.localeCompare(a.date);
			});
	} catch (error) {
		throw new Error(toErrorMessage("getPublishedPosts", error), { cause: error });
	}
}

export async function getPostBlocks(
	pageId: string,
): Promise<NotionBlockWithChildren[]> {
	if (!pageId) {
		throw new Error("getPostBlocks failed: pageId is required.");
	}

	try {
		const { notion } = createNotionClient();
		return await fetchChildBlocks(notion, pageId);
	} catch (error) {
		throw new Error(toErrorMessage("getPostBlocks", error), { cause: error });
	}
}
