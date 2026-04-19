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

export type PostType = "Article" | "Diary";

export interface PublishedPost {
	pageId: string;
	type: PostType;
	title: string;
	slug: string;
	date: string | null;
	tags: string[];
	series?: string;
	description: string;
	properties: {
		ShowToC: boolean;
	};
}

interface GetPublishedPostsOptions {
	type?: PostType;
}

export type NotionBlockWithChildren = BlockObjectResponse & {
	children?: NotionBlockWithChildren[];
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

function getCheckboxValue(
	property: PageObjectResponse["properties"][string] | undefined,
): boolean {
	if (!property || property.type !== "checkbox") {
		return false;
	}

	return property.checkbox;
}

function getSelectValue(
	property: PageObjectResponse["properties"][string] | undefined,
): string | undefined {
	if (!property || property.type !== "select") {
		return undefined;
	}

	return property.select?.name ?? undefined;
}

function getPostType(
	property: PageObjectResponse["properties"][string] | undefined,
): PostType {
	const value = getSelectValue(property);

	return value === "Diary" ? "Diary" : "Article";
}

async function mapPageToPublishedPost(
	page: PageObjectResponse,
): Promise<PublishedPost> {
	const title = getPlainText(page.properties.Title);
	const type = getPostType(page.properties.Type);
	const slug = getPlainText(page.properties.Slug);
	const date = getDateValue(page.properties.Date);
	const tags = getTagNames(page.properties.Tags);
	const series = getSelectValue(page.properties.Series);
	const description = getPlainText(page.properties.Description);
	const showToC = getCheckboxValue(page.properties.ShowToC);

	return {
		pageId: page.id,
		type,
		title: title || "Untitled",
		slug: slug || page.id,
		date,
		tags,
		series,
		description,
		properties: {
			ShowToC: showToC,
		},
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
			if (!block.has_children) {
				return block;
			}

			const children = await fetchChildBlocks(notion, block.id);
			return { ...block, children };
		}),
	);
}

export async function getPublishedPosts(
	options: GetPublishedPostsOptions = {},
): Promise<PublishedPost[]> {
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

		const posts = await Promise.all(
			results.filter(isFullPage).map((page) => mapPageToPublishedPost(page)),
		);

		const filteredPosts = options.type
			? posts.filter((post) => post.type === options.type)
			: posts;

		return filteredPosts.sort((a, b) => {
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
