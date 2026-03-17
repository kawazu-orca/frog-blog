import type { NotionBlockWithChildren } from "./notion";

type ImageBlock = Extract<NotionBlockWithChildren, { type: "image" }>;
type ImageFit = "cover" | "contain" | "fill" | "inside" | "outside";

type OptimizeImageOptions = {
	subdir?: string;
	width?: number;
	height?: number;
	fit?: ImageFit;
	quality?: number;
};

type NodeImagePipeline = {
	fs: typeof import("node:fs/promises");
	path: typeof import("node:path");
	sharp: typeof import("sharp").default;
};

let nodeImagePipeline: NodeImagePipeline | null | undefined;

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

function sanitizeFileKey(fileKey: string): string {
	return fileKey.replace(/[^a-zA-Z0-9-_]/g, "-");
}

async function loadNodeImagePipeline(): Promise<NodeImagePipeline | null> {
	if (nodeImagePipeline !== undefined) {
		return nodeImagePipeline;
	}

	try {
		const fsModule = `node:${"fs/promises"}`;
		const pathModule = `node:${"path"}`;
		const sharpModule = "sharp";

		const fs = await import(fsModule);
		const path = await import(pathModule);
		const sharpImport = await import(sharpModule);
		const sharp = sharpImport.default;

		nodeImagePipeline = { fs, path, sharp };
		return nodeImagePipeline;
	} catch {
		nodeImagePipeline = null;
		return null;
	}
}

export async function downloadAndOptimizeImage(
	imageUrl: string,
	fileKey: string,
	options: OptimizeImageOptions = {},
): Promise<string> {
	if (!shouldOptimizeAtBuildTime()) {
		return imageUrl;
	}

	const nodeTools = await loadNodeImagePipeline();
	if (!nodeTools) {
		return imageUrl;
	}

	const { fs, path, sharp } = nodeTools;

	const subdir = options.subdir ?? "posts";
	const width = options.width ?? 1200;
	const height = options.height;
	const fit = options.fit ?? (height ? "cover" : "inside");
	const quality = options.quality ?? 80;

	const imageDir = path.join(process.cwd(), "public", "images", subdir);
	await fs.mkdir(imageDir, { recursive: true });

	const fileName = `${sanitizeFileKey(fileKey)}.webp`;
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
	const imagePipeline = sharp(sourceData).resize({
		width,
		height,
		fit,
		withoutEnlargement: true,
	});

	await imagePipeline.webp({ quality }).toFile(destination);

	return `/images/${subdir}/${fileName}`;
}

async function optimizeNotionImageToWebp(
	imageUrl: string,
	blockId: string,
): Promise<string> {
	return await downloadAndOptimizeImage(imageUrl, blockId, {
		subdir: "posts",
		width: 1200,
		quality: 80,
	});
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
