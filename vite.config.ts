import { defineConfig, type Plugin } from 'vite';
import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { siteOrigin } from './shared/domain.ts';

// Open Graph, canonical and JSON-LD URLs always use the real site address
// (https://www.goldenstay.space), or SITE_URL when it is an https:// address.
const siteUrl = siteOrigin(process.env.SITE_URL);

function siteUrlPlugin(): Plugin {
  return {
    name: 'golden-stay-site-url',
    transformIndexHtml(html) {
      const out = html.replaceAll('__SITE_URL__', siteUrl);
      if (!siteUrl) return out;
      return {
        html: out,
        tags: [
          { tag: 'link', attrs: { rel: 'canonical', href: `${siteUrl}/` }, injectTo: 'head' },
          { tag: 'meta', attrs: { property: 'og:url', content: `${siteUrl}/` }, injectTo: 'head' },
        ],
      };
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), siteUrlPlugin()],
  define: { __BUILD_YEAR__: JSON.stringify(new Date().getFullYear()) },
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        book: resolve(import.meta.dirname, 'book/index.html'),
        booking: resolve(import.meta.dirname, 'booking/index.html'),
        admin: resolve(import.meta.dirname, 'admin/index.html'),
        account: resolve(import.meta.dirname, 'account/index.html'),
        confirm: resolve(import.meta.dirname, 'confirm/index.html'),
      },
    },
  },
  // In development the API server runs separately (npm run dev starts both).
  server: { proxy: { '/api': 'http://localhost:8787' } },
});
