/// <reference types="astro/client" />

interface ImportMetaEnv {
	readonly NOTION_API_KEY: string;
	readonly NOTION_DATABASE_ID: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}

declare namespace NodeJS {
	interface ProcessEnv {
		NOTION_API_KEY?: string;
		NOTION_DATABASE_ID?: string;
		CI?: string;
	}
}
