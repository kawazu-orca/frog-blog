// @ts-check
import { defineConfig } from 'astro/config';

import cloudflare from '@astrojs/cloudflare';
import sitemap from '@astrojs/sitemap';

async function loadDiaryRedirects() {
  try {
    const redirects = await import('./src/generated/diary-redirects.json', {
      with: { type: 'json' }
    });
    return redirects.default;
  } catch {
    return {};
  }
}

const diaryRedirects = await loadDiaryRedirects();

// https://astro.build/config
export default defineConfig({
  site: 'https://frog-blog.kawazu.workers.dev',
  adapter: cloudflare(),
  integrations: [sitemap()],
  redirects: diaryRedirects
});
