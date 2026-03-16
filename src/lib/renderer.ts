import type { RichTextItemResponse } from "@notionhq/client/build/src/api-endpoints";
import katex from "katex";
import { resolveImageSrc } from "./images";
import type { NotionBlockWithChildren } from "./notion";

type BlockType = NotionBlockWithChildren["type"];
type BlockOf<T extends BlockType> = Extract<NotionBlockWithChildren, { type: T }>;

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

function renderRichTextItem(item: RichTextItemResponse): string {
	const annotations = item.annotations;
	let content = "";

	if (item.type === "text") {
		content = escapeHtml(item.text.content);
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

function renderRichText(items: RichTextItemResponse[]): string {
	return items.map((item) => renderRichTextItem(item)).join("");
}

async function renderChildren(block: NotionBlockWithChildren): Promise<string> {
	if (!block.children || block.children.length === 0) {
		return "";
	}

	return await renderBlocks(block.children);
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
): Promise<string> {
	const item = block.bulleted_list_item;
	return `<li>${renderRichText(item.rich_text)}${await renderChildren(block)}</li>`;
}

async function renderNumberedListItem(
	block: BlockOf<"numbered_list_item">,
): Promise<string> {
	const item = block.numbered_list_item;
	return `<li>${renderRichText(item.rich_text)}${await renderChildren(block)}</li>`;
}

async function renderBlock(block: NotionBlockWithChildren): Promise<string> {
	switch (block.type) {
		case "heading_1": {
			const item = block.heading_1;
			return `<h1>${renderRichText(item.rich_text)}</h1>`;
		}
		case "heading_2": {
			const item = block.heading_2;
			return `<h2>${renderRichText(item.rich_text)}</h2>`;
		}
		case "heading_3": {
			const item = block.heading_3;
			return `<h3>${renderRichText(item.rich_text)}</h3>`;
		}
		case "paragraph": {
			const item = block.paragraph;
			return `<p>${renderRichText(item.rich_text)}</p>${await renderChildren(block)}`;
		}
		case "callout": {
			const item = block.callout;
			const calloutClass = getCalloutClass(block);
			return `<div class="callout ${calloutClass}" data-notion-color="${escapeAttr(
				item.color,
			)}"><div class="callout-body">${renderCalloutIcon(
				block,
			)}<div class="callout-content">${renderRichText(
				item.rich_text,
			)}${await renderChildren(block)}</div></div></div>`;
		}
		case "toggle": {
			const item = block.toggle;
			return `<details><summary>${renderRichText(
				item.rich_text,
			)}</summary>${await renderChildren(block)}</details>`;
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
			const caption = renderRichText(item.caption);
			return `<figure><img src="${escapeAttr(src)}" alt="${escapeAttr(
				item.caption.map((richTextItem) => richTextItem.plain_text).join(""),
			)}" />${caption ? `<figcaption>${caption}</figcaption>` : ""}</figure>`;
		}
		case "quote": {
			const item = block.quote;
			return `<blockquote>${renderRichText(item.rich_text)}${await renderChildren(
				block,
			)}</blockquote>`;
		}
		case "divider":
			return "<hr />";
		case "to_do": {
			const item = block.to_do;
			return `<label><input type="checkbox"${
				item.checked ? " checked" : ""
			} disabled /> ${renderRichText(item.rich_text)}</label>${await renderChildren(block)}`;
		}
		case "bulleted_list_item":
			return await renderBulletedListItem(block);
		case "numbered_list_item":
			return await renderNumberedListItem(block);
		default:
			return `<!-- unsupported block: ${block.type} -->`;
	}
}

export async function renderBlocks(blocks: NotionBlockWithChildren[]): Promise<string> {
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
				items.push(await renderBulletedListItem(current));
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
				items.push(await renderNumberedListItem(current));
			}
			index -= 1;
			html.push(`<ol>${items.join("")}</ol>`);
			continue;
		}

		html.push(await renderBlock(block));
	}

	return html.join("");
}
