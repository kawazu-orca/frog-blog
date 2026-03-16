import type { NotionBlockWithChildren } from "./notion";

type ImageBlock = Extract<NotionBlockWithChildren, { type: "image" }>;

function getImageUrl(block: ImageBlock): string {
	return block.image.type === "external" ? block.image.external.url : block.image.file.url;
}

function isNotionSignedUrl(url: string): boolean {
	return url.includes("secure.notion-static.com");
}

function shouldOptimizeAtBuildTime(): boolean {
	return (
		process.env.npm_lifecycle_event === "build" ||
		process.env.GITHUB_ACTIONS === "true"
	);
}

async function optimizeNotionImageToWebp(
	imageUrl: string,
	blockId: string,
): Promise<string> {
	const fsModule = `node:${"fs/promises"}`;
	const pathModule = `node:${"path"}`;
	const sharpModule = "sharp";

	const fs = await import(fsModule);
	const path = await import(pathModule);
	const sharpImport = await import(sharpModule);
	const sharp = sharpImport.default;

	const imageDir = path.join(process.cwd(), "public", "images", "posts");
	await fs.mkdir(imageDir, { recursive: true });

	const fileName = `${blockId}.webp`;
	const destination = path.join(imageDir, fileName);

	try {
		await fs.access(destination);
		return `/images/posts/${fileName}`;
	} catch {
		// Keep going when the file does not exist yet.
	}

	const response = await fetch(imageUrl);
	if (!response.ok) {
		throw new Error(`Failed to download image: ${response.status} ${response.statusText}`);
	}

	const sourceData = new Uint8Array(await response.arrayBuffer());
	await sharp(sourceData)
		.resize({ width: 1200, withoutEnlargement: true })
		.webp({ quality: 80 })
		.toFile(destination);

	return `/images/posts/${fileName}`;
}

export async function resolveImageSrc(block: ImageBlock): Promise<string> {
	const sourceUrl = getImageUrl(block);

	if (!isNotionSignedUrl(sourceUrl)) {
		return sourceUrl;
	}

	if (!block.id || !shouldOptimizeAtBuildTime()) {
		return sourceUrl;
	}

	try {
		return await optimizeNotionImageToWebp(sourceUrl, block.id);
	} catch (error) {
		console.error(
			`[images] Failed to optimize image block ${block.id}; falling back to source URL.`,
			error,
		);
		return sourceUrl;
	}
}
