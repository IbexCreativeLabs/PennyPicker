import { mdsvex } from 'mdsvex';
import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

const dev = process.env.NODE_ENV === 'development';
const buildDir = process.env.NODE_ENV === 'production' ? '../../docs' : '';

const config = {
	preprocess: [
		vitePreprocess(),
		mdsvex({
			extensions: ['.md']
		})],
	kit: {
		adapter: adapter({
			pages: buildDir,
			assets: buildDir,
			// Named 404.html so Cloudflare Pages answers missing files with a real 404 instead of
			// serving the app shell as 200 (which a browser could cache in place of a script).
			fallback: '404.html'
		}),
		alias:{
	      $workers: 'src/lib/workers'
		},
		prerender:{
			entries: ["*"]
		}
	},
	extensions: ['.svelte', '.svx', '.md']
};

export default config;
