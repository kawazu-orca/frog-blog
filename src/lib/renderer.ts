import type { RichTextItemResponse } from "@notionhq/client/build/src/api-endpoints";
import katex from "katex";
import { resolveImageSrc } from "./images";
import type { NotionBlockWithChildren } from "./notion";

type BlockType = NotionBlockWithChildren["type"];
type BlockOf<T extends BlockType> = Extract<NotionBlockWithChildren, { type: T }>;
type SlugCounter = Map<string, number>;

export type Heading = { id: string; text: string; level: 2 | 3 };
export type Footnote = { id: number; targetId: string; text: string };

interface RenderBlocksOptions {
	idPrefix?: string;
	enhanceJapaneseSpacing?: boolean;
}

type RenderContext = {
	slugCounter: SlugCounter;
	footnotes: Footnote[];
	footnoteIndex: number;
	idPrefix: string;
	enhanceJapaneseSpacing: boolean;
};

function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}

function escapeAttr(value: string): string {
	return escapeHtml(value);
}

const japaneseLetterPattern = "[\\u3040-\\u30ff\\u3400-\\u9fff]";
const latinLetterPattern = "[A-Za-z]";

function applyJapaneseSpacing(text: string): string {
	return text
		.replace(
			new RegExp(`(${latinLetterPattern})(?=${japaneseLetterPattern})`, "g"),
			'$1<span class="jp-script-gap"></span>',
		)
		.replace(
			new RegExp(`(${japaneseLetterPattern})(?=${latinLetterPattern})`, "g"),
			'$1<span class="jp-script-gap"></span>',
		)
		.replace(
			/[、。]/g,
			(match) => `<span class="jp-punct jp-comma-period">${match}</span>`,
		)
		.replace(
			/[！？]/g,
			(match) => `<span class="jp-punct jp-exclaim-question">${match}</span>`,
		)
		.replace(
			/[「『（〔［【]/g,
			(match) => `<span class="jp-punct jp-bracket-open">${match}</span>`,
		)
		.replace(
			/[」』）〕］】]/g,
			(match) => `<span class="jp-punct jp-bracket-close">${match}</span>`,
		);
}

export function renderJapaneseSpacedText(text: string): string {
	return applyJapaneseSpacing(escapeHtml(text));
}

function notionColorToCss(color: string): string | null {
	const map: Record<string, string> = {
		gray_background: "#f1f1ef",
		brown_background: "#f4eeee",
		orange_background: "#fbeedd",
		yellow_background: "#fbf3db",
		green_background: "#edf3ec",
		blue_background: "#e7f3f8",
		purple_background: "#f6f3f8",
		pink_background: "#faeefa",
		red_background: "#fdebec",
	};

	return map[color] ?? null;
}

function renderInlineColor(
	text: string,
	color: RichTextItemResponse["annotations"]["color"],
): string {
	if (color === "default") {
		return text;
	}

	if (color.endsWith("_background")) {
		return `<span style="background-color:${escapeAttr(
			notionColorToCss(color) ?? "transparent",
		)}" data-notion-color="${escapeAttr(color)}">${text}</span>`;
	}

	return `<span style="color:${escapeAttr(
		color.replace("_", "-"),
	)}" data-notion-color="${escapeAttr(color)}">${text}</span>`;
}

function tryParseUrl(url: string): URL | null {
	try {
		return new URL(url);
	} catch {
		return null;
	}
}

function toYouTubeEmbedUrl(url: string): string | null {
	const parsed = tryParseUrl(url);
	if (!parsed) {
		return null;
	}

	if (parsed.hostname.includes("youtu.be")) {
		const videoId = parsed.pathname.split("/").filter(Boolean)[0];
		return videoId ? `https://www.youtube.com/embed/${videoId}` : null;
	}

	if (
		parsed.hostname.includes("youtube.com") ||
		parsed.hostname.includes("youtube-nocookie.com")
	) {
		if (parsed.pathname === "/watch") {
			const videoId = parsed.searchParams.get("v");
			return videoId ? `https://www.youtube.com/embed/${videoId}` : null;
		}

		if (parsed.pathname.startsWith("/shorts/")) {
			const videoId = parsed.pathname.split("/").filter(Boolean)[1];
			return videoId ? `https://www.youtube.com/embed/${videoId}` : null;
		}

		if (parsed.pathname.startsWith("/live/")) {
			const videoId = parsed.pathname.split("/").filter(Boolean)[1];
			return videoId ? `https://www.youtube.com/embed/${videoId}` : null;
		}

		if (parsed.pathname.startsWith("/embed/")) {
			return url;
		}
	}

	return null;
}

function toVimeoEmbedUrl(url: string): string | null {
	const parsed = tryParseUrl(url);
	if (!parsed) {
		return null;
	}

	if (!parsed.hostname.includes("vimeo.com")) {
		return null;
	}

	const id = parsed.pathname.split("/").filter(Boolean)[0];
	return id && /^\d+$/.test(id) ? `https://player.vimeo.com/video/${id}` : null;
}

function toEmbedUrl(url: string): string {
	return toYouTubeEmbedUrl(url) ?? toVimeoEmbedUrl(url) ?? url;
}

function toXPostUrl(url: string): string | null {
	const parsed = tryParseUrl(url);
	if (!parsed) {
		return null;
	}

	const isXDomain =
		parsed.hostname.includes("x.com") ||
		parsed.hostname.includes("twitter.com") ||
		parsed.hostname.includes("www.twitter.com");
	if (!isXDomain) {
		return null;
	}

	const parts = parsed.pathname.split("/").filter(Boolean);
	// /{user}/status/{id}
	if (parts.length >= 3 && parts[1] === "status" && parts[2]) {
		return `https://twitter.com/${parts[0]}/status/${parts[2]}`;
	}
	// /i/web/status/{id}
	if (
		parts.length >= 4 &&
		parts[0] === "i" &&
		parts[1] === "web" &&
		parts[2] === "status" &&
		parts[3]
	) {
		return `https://twitter.com/i/web/status/${parts[3]}`;
	}

	return null;
}

function extractXPostId(url: string): string | null {
	const parsed = tryParseUrl(url);
	if (!parsed) {
		return null;
	}

	const parts = parsed.pathname.split("/").filter(Boolean);
	if (parts.length >= 3 && parts[1] === "status" && /^\d+$/.test(parts[2])) {
		return parts[2];
	}

	if (
		parts.length >= 4 &&
		parts[0] === "i" &&
		parts[1] === "web" &&
		parts[2] === "status" &&
		/^\d+$/.test(parts[3])
	) {
		return parts[3];
	}

	return null;
}

function renderXEmbed(url: string): string {
	const postId = extractXPostId(url);
	if (!postId) {
		return `<p><a href="${escapeAttr(
			url,
		)}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a></p>`;
	}
	const canonical = toXPostUrl(url) ?? `https://twitter.com/i/web/status/${postId}`;
	return `<blockquote class="twitter-tweet" data-dnt="true" data-align="center" data-width="420" data-theme="light"><a href="${escapeAttr(
		canonical,
	)}">${escapeHtml(canonical)}</a></blockquote>`;
}

function extractStandaloneUrlFromRichText(
	items: RichTextItemResponse[],
): string | null {
	const joined = items.map((item) => item.plain_text).join("").trim();
	if (!joined) {
		return null;
	}

	// 段落全体がURLのみ（前後の空白のみ許可）の場合に抽出
	const urlOnlyMatch = joined.match(
		/^(https?:\/\/[^\s<>"'`]+)$/i,
	);
	if (urlOnlyMatch) {
		return urlOnlyMatch[1];
	}

	// link属性付きテキストが1つだけの場合の保険
	const linked = items
		.filter((item) => item.type === "text" && item.text.link?.url)
		.map((item) => item.text.link!.url);
	if (linked.length === 1) {
		return linked[0];
	}

	return null;
}

function extractFileLikeUrl(
	item: unknown,
): { url: string | null; kind: "external" | "file" | "unknown" } {
	if (!item || typeof item !== "object") {
		return { url: null, kind: "unknown" };
	}

	const source = item as {
		type?: string;
		external?: { url?: string };
		file?: { url?: string };
	};

	if (source.type === "external") {
		return { url: source.external?.url ?? null, kind: "external" };
	}

	if (source.type === "file") {
		return { url: source.file?.url ?? null, kind: "file" };
	}

	if (source.external?.url) {
		return { url: source.external.url, kind: "external" };
	}

	if (source.file?.url) {
		return { url: source.file.url, kind: "file" };
	}

	return { url: null, kind: "unknown" };
}

function renderRichTextItem(
	item: RichTextItemResponse,
	context: RenderContext,
): string {
	const annotations = item.annotations;
	let content = "";

	if (item.type === "text") {
		content = escapeHtml(item.text.content);
		if (context.enhanceJapaneseSpacing && !annotations.code) {
			content = applyJapaneseSpacing(content);
		}
		if (item.text.link?.url) {
			content = `<a href="${escapeAttr(item.text.link.url)}">${content}</a>`;
		}
	} else if (item.type === "equation") {
		content = katex.renderToString(item.equation.expression, {
			displayMode: false,
			throwOnError: false,
		});
	} else {
		content = escapeHtml(item.plain_text);
	}

	if (annotations.code) {
		content = `<code>${content}</code>`;
	}
	if (annotations.bold) {
		content = `<strong>${content}</strong>`;
	}
	if (annotations.italic) {
		content = `<em>${content}</em>`;
	}
	if (annotations.strikethrough) {
		content = `<s>${content}</s>`;
	}
	if (annotations.underline) {
		content = `<u>${content}</u>`;
	}

	return renderInlineColor(content, annotations.color);
}

function renderRichText(
	items: RichTextItemResponse[],
	context: RenderContext,
): string {
	return items.map((item) => renderRichTextItem(item, context)).join("");
}

function getRichTextPlainText(items: RichTextItemResponse[]): string {
	return items.map((item) => item.plain_text).join("").trim();
}

function getRichTextPlainTextWithoutFootnotes(
	items: RichTextItemResponse[],
): string {
	return items
		.filter((item) => !extractInlineCodeFootnote(item))
		.map((item) => item.plain_text)
		.join("")
		.trim();
}

function getPlainTextForBlock(block: NotionBlockWithChildren): string {
	switch (block.type) {
		case "heading_1":
			return getRichTextPlainTextWithoutFootnotes(block.heading_1.rich_text);
		case "heading_2":
			return getRichTextPlainTextWithoutFootnotes(block.heading_2.rich_text);
		case "heading_3":
			return getRichTextPlainTextWithoutFootnotes(block.heading_3.rich_text);
		case "paragraph":
			return getRichTextPlainTextWithoutFootnotes(block.paragraph.rich_text);
		case "bulleted_list_item":
			return getRichTextPlainTextWithoutFootnotes(
				block.bulleted_list_item.rich_text,
			);
		case "numbered_list_item":
			return getRichTextPlainTextWithoutFootnotes(
				block.numbered_list_item.rich_text,
			);
		case "quote":
			return getRichTextPlainTextWithoutFootnotes(block.quote.rich_text);
		case "callout":
			return getRichTextPlainTextWithoutFootnotes(block.callout.rich_text);
		case "toggle":
			return getRichTextPlainTextWithoutFootnotes(block.toggle.rich_text);
		case "to_do":
			return getRichTextPlainTextWithoutFootnotes(block.to_do.rich_text);
		case "code":
			return block.code.rich_text.map((item) => item.plain_text).join("").trim();
		case "equation":
			return block.equation.expression.trim();
		default:
			return "";
	}
}

export function extractPlainTextFromBlocks(
	blocks: NotionBlockWithChildren[],
): string {
	const parts: string[] = [];

	const walk = (items: NotionBlockWithChildren[]) => {
		for (const block of items) {
			const text = getPlainTextForBlock(block);
			if (text) {
				parts.push(text);
			}
			if (block.children && block.children.length > 0) {
				walk(block.children);
			}
		}
	};

	walk(blocks);
	return parts.join(" ").replace(/\s+/g, " ").trim();
}

function slugifyHeading(text: string): string {
	return text
		.toLowerCase()
		.replace(/\s+/g, "-")
		.replace(/[^a-z0-9\u3040-\u30ff\u3400-\u9fff-]/g, "")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "");
}

function createUniqueHeadingId(text: string, slugCounter: SlugCounter): string {
	const baseSlug = slugifyHeading(text) || "section";
	const current = slugCounter.get(baseSlug) ?? 0;
	const next = current + 1;
	slugCounter.set(baseSlug, next);
	return next === 1 ? baseSlug : `${baseSlug}-${next}`;
}

function extractInlineCodeFootnote(item: RichTextItemResponse): string | null {
	if (!item.annotations.code) {
		return null;
	}

	if (!item.plain_text.startsWith("fn:")) {
		return null;
	}

	const text = item.plain_text.slice(3).trim();
	return text.length > 0 ? text : null;
}

function renderRichTextWithFootnoteMarkers(
	items: RichTextItemResponse[],
	context: RenderContext,
): string {
	const html: string[] = [];

	for (const item of items) {
		const footnoteText = extractInlineCodeFootnote(item);
		if (!footnoteText) {
			html.push(renderRichTextItem(item, context));
			continue;
		}

		context.footnoteIndex += 1;
		const index = context.footnoteIndex;
		const targetId = `${context.idPrefix}${index}`;
		context.footnotes.push({ id: index, targetId, text: footnoteText });
		html.push(
			`<sup class="sidenote-ref" id="fnref-${targetId}"><a href="#fn-${targetId}" aria-describedby="fn-${targetId}">${index}</a></sup>`,
		);
	}

	return html.join("");
}

async function renderChildren(
	block: NotionBlockWithChildren,
	context: RenderContext,
): Promise<string> {
	if (!block.children || block.children.length === 0) {
		return "";
	}

	return await renderBlocksWithContext(block.children, context);
}

function renderCalloutIcon(block: BlockOf<"callout">): string {
	if (!block.callout.icon) {
		return "";
	}

	if (block.callout.icon.type === "emoji") {
		return `<span class="callout-icon">${escapeHtml(block.callout.icon.emoji)}</span>`;
	}

	return "";
}

function getCalloutClass(block: BlockOf<"callout">): string {
	if (!block.callout.icon || block.callout.icon.type !== "emoji") {
		return "callout-default";
	}

	const classMap: Record<string, string> = {
		"📣": "callout-pullquote",
		"📘": "callout-definition",
		"⭐": "callout-theorem",
		"🧩": "callout-lemma",
		"🔁": "callout-corollary",
		"💡": "callout-example",
		"⚠️": "callout-warning",
		"🧠": "callout-intuition",
		"✅": "callout-summary",
	};

	return classMap[block.callout.icon.emoji] ?? "callout-default";
}

async function renderBulletedListItem(
	block: BlockOf<"bulleted_list_item">,
	context: RenderContext,
): Promise<string> {
	const item = block.bulleted_list_item;
	return `<li>${renderRichTextWithFootnoteMarkers(
		item.rich_text,
		context,
	)}${await renderChildren(block, context)}</li>`;
}

async function renderNumberedListItem(
	block: BlockOf<"numbered_list_item">,
	context: RenderContext,
): Promise<string> {
	const item = block.numbered_list_item;
	return `<li>${renderRichTextWithFootnoteMarkers(
		item.rich_text,
		context,
	)}${await renderChildren(block, context)}</li>`;
}

async function renderBlock(
	block: NotionBlockWithChildren,
	context: RenderContext,
): Promise<string> {
	switch (block.type) {
		case "heading_1": {
			const item = block.heading_1;
			return `<h1>${renderRichTextWithFootnoteMarkers(item.rich_text, context)}</h1>`;
		}
		case "heading_2": {
			const item = block.heading_2;
			const text = getRichTextPlainText(item.rich_text);
			const id = createUniqueHeadingId(text, context.slugCounter);
			return `<h2 id="${escapeAttr(id)}">${renderRichTextWithFootnoteMarkers(
				item.rich_text,
				context,
			)}</h2>`;
		}
		case "heading_3": {
			const item = block.heading_3;
			const text = getRichTextPlainText(item.rich_text);
			const id = createUniqueHeadingId(text, context.slugCounter);
			return `<h3 id="${escapeAttr(id)}">${renderRichTextWithFootnoteMarkers(
				item.rich_text,
				context,
			)}</h3>`;
		}
		case "paragraph": {
			const item = block.paragraph;
			const maybeStandaloneUrl = extractStandaloneUrlFromRichText(
				item.rich_text,
			);
			if (maybeStandaloneUrl) {
				const xPostUrl = toXPostUrl(maybeStandaloneUrl.trim());
				if (xPostUrl) {
					return renderXEmbed(xPostUrl);
				}
			}
			return `<p>${renderRichTextWithFootnoteMarkers(
				item.rich_text,
				context,
			)}</p>${await renderChildren(block, context)}`;
		}
		case "callout": {
			const item = block.callout;
			const calloutClass = getCalloutClass(block);
			return `<div class="callout ${calloutClass}" data-notion-color="${escapeAttr(
				item.color,
			)}"><div class="callout-body">${renderCalloutIcon(
				block,
			)}<div class="callout-content">${renderRichTextWithFootnoteMarkers(
				item.rich_text,
				context,
			)}${await renderChildren(block, context)}</div></div></div>`;
		}
		case "toggle": {
			const item = block.toggle;
			return `<details><summary>${renderRichTextWithFootnoteMarkers(
				item.rich_text,
				context,
			)}</summary>${await renderChildren(
				block,
				context,
			)}</details>`;
		}
		case "code": {
			const item = block.code;
			return `<pre><code class="language-${escapeAttr(
				item.language,
			)}" data-language="${escapeAttr(item.language)}">${escapeHtml(
				item.rich_text.map((richTextItem) => richTextItem.plain_text).join(""),
			)}</code></pre>`;
		}
		case "equation": {
			const item = block.equation;
			return katex.renderToString(item.expression, {
				displayMode: true,
				throwOnError: false,
			});
		}
		case "image": {
			const item = block.image;
			const src = await resolveImageSrc(block);
			const caption = renderRichText(item.caption, context);
			return `<figure><img src="${escapeAttr(src)}" alt="${escapeAttr(
				item.caption.map((richTextItem) => richTextItem.plain_text).join(""),
			)}" />${caption ? `<figcaption>${caption}</figcaption>` : ""}</figure>`;
		}
		case "quote": {
			const item = block.quote;
			return `<blockquote>${renderRichTextWithFootnoteMarkers(
				item.rich_text,
				context,
			)}${await renderChildren(
				block,
				context,
			)}</blockquote>`;
		}
		case "video": {
			const item = block.video;
			const { url } = extractFileLikeUrl(item);
			if (!url) {
				return "<!-- unsupported block: video(no-url) -->";
			}
			const maybeEmbedUrl = toEmbedUrl(url);
			if (maybeEmbedUrl !== url) {
				const caption = renderRichText(item.caption, context);
				return `<figure><div class="embed-block"><iframe src="${escapeAttr(
					maybeEmbedUrl,
				)}" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe></div>${
					caption ? `<figcaption>${caption}</figcaption>` : ""
				}</figure>`;
			}
			const caption = renderRichText(item.caption, context);
			return `<figure><video controls preload="metadata" src="${escapeAttr(
				url,
			)}"></video>${caption ? `<figcaption>${caption}</figcaption>` : ""}</figure>`;
		}
		case "audio": {
			const item = block.audio;
			const { url } = extractFileLikeUrl(item);
			if (!url) {
				return "<!-- unsupported block: audio(no-url) -->";
			}
			const caption = renderRichText(item.caption, context);
			return `<figure><audio controls preload="metadata" src="${escapeAttr(
				url,
			)}"></audio>${caption ? `<figcaption>${caption}</figcaption>` : ""}</figure>`;
		}
		case "embed": {
			const item = block.embed;
			const xPostUrl = toXPostUrl(item.url);
			if (xPostUrl) {
				return renderXEmbed(xPostUrl);
			}
			const embedUrl = toEmbedUrl(item.url);
			return `<div class="embed-block"><iframe src="${escapeAttr(
				embedUrl,
			)}" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe></div>`;
		}
		case "bookmark": {
			const item = block.bookmark;
			const xPostUrl = toXPostUrl(item.url);
			if (xPostUrl) {
				return renderXEmbed(xPostUrl);
			}
			return `<p><a href="${escapeAttr(item.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(
				item.url,
			)}</a></p>`;
		}
		case "file": {
			const item = block.file;
			const { url } = extractFileLikeUrl(item);
			if (!url) {
				return "<!-- unsupported block: file(no-url) -->";
			}
			const caption = renderRichText(item.caption, context);
			return `<p><a href="${escapeAttr(
				url,
			)}" target="_blank" rel="noopener noreferrer">ファイルを開く</a>${
				caption ? ` ${caption}` : ""
			}</p>`;
		}
		case "pdf": {
			const item = block.pdf;
			const { url } = extractFileLikeUrl(item);
			if (!url) {
				return "<!-- unsupported block: pdf(no-url) -->";
			}
			return `<div class="embed-block"><iframe src="${escapeAttr(
				url,
			)}" loading="lazy"></iframe></div>`;
		}
		case "divider":
			return "<hr />";
		case "to_do": {
			const item = block.to_do;
			return `<label><input type="checkbox"${
				item.checked ? " checked" : ""
			} disabled /> ${renderRichTextWithFootnoteMarkers(
				item.rich_text,
				context,
			)}</label>${await renderChildren(
				block,
				context,
			)}`;
		}
		case "bulleted_list_item":
			return await renderBulletedListItem(block, context);
		case "numbered_list_item":
			return await renderNumberedListItem(block, context);
		default:
			return `<!-- unsupported block: ${block.type} -->`;
	}
}

async function renderBlocksWithContext(
	blocks: NotionBlockWithChildren[],
	context: RenderContext,
): Promise<string> {
	const html: string[] = [];

	for (let index = 0; index < blocks.length; index += 1) {
		const block = blocks[index];

		if (block.type === "bulleted_list_item") {
			const items: string[] = [];
			for (; index < blocks.length; index += 1) {
				const current = blocks[index];
				if (current.type !== "bulleted_list_item") {
					break;
				}
				items.push(await renderBulletedListItem(current, context));
			}
			index -= 1;
			html.push(`<ul>${items.join("")}</ul>`);
			continue;
		}

		if (block.type === "numbered_list_item") {
			const items: string[] = [];
			for (; index < blocks.length; index += 1) {
				const current = blocks[index];
				if (current.type !== "numbered_list_item") {
					break;
				}
				items.push(await renderNumberedListItem(current, context));
			}
			index -= 1;
			html.push(`<ol>${items.join("")}</ol>`);
			continue;
		}

		html.push(await renderBlock(block, context));
	}

	return html.join("");
}

export async function renderBlocks(
	blocks: NotionBlockWithChildren[],
	options: RenderBlocksOptions = {},
): Promise<{ html: string; footnotes: Footnote[] }> {
	const context: RenderContext = {
		slugCounter: new Map(),
		footnotes: [],
		footnoteIndex: 0,
		idPrefix: options.idPrefix ?? "",
		enhanceJapaneseSpacing: options.enhanceJapaneseSpacing ?? false,
	};

	const html = await renderBlocksWithContext(blocks, context);
	return { html, footnotes: context.footnotes };
}

export function extractHeadings(blocks: NotionBlockWithChildren[]): Heading[] {
	const slugCounter: SlugCounter = new Map();
	const headings: Heading[] = [];

	const walk = (items: NotionBlockWithChildren[]) => {
		for (const block of items) {
			if (block.type === "heading_2") {
				const text = getRichTextPlainText(block.heading_2.rich_text);
				headings.push({
					id: createUniqueHeadingId(text, slugCounter),
					text,
					level: 2,
				});
			} else if (block.type === "heading_3") {
				const text = getRichTextPlainText(block.heading_3.rich_text);
				headings.push({
					id: createUniqueHeadingId(text, slugCounter),
					text,
					level: 3,
				});
			}

			if (block.children && block.children.length > 0) {
				walk(block.children);
			}
		}
	};

	walk(blocks);
	return headings;
}
