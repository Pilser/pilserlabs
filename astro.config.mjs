import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';

export default defineConfig({
  site: 'https://pilserlabs.com',
  output: 'server',
  adapter: cloudflare({
    imageService: 'passthrough',
  }),
  session: false,
  vite: {
    build: {
      minify: false,
    },
  },
});