import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

// Build identity shown in the app and attached to feedback (Cloudflare Pages / GitHub Actions / local).
const commit = (process.env.CF_PAGES_COMMIT_SHA || process.env.GITHUB_SHA || 'local').slice(0, 7);
const branch = process.env.CF_PAGES_BRANCH || process.env.GITHUB_REF_NAME || 'local';

export default defineConfig({
	define: {
		__PENNYPICKER_BUILD__: JSON.stringify({ commit, branch, builtAt: new Date().toISOString() })
	},
	plugins: [
		sveltekit()
	],
	optimizeDeps: {
		esbuildOptions: {
			target: 'esnext'
		}
	},
	build: {
		target: ["esnext"], // for bigints
		commonjsOptions: {
			transformMixedEsModules: true,
			// linked modules in a monorepo must be explicitly included
			include: [
				/@fbch\/lib/,
				/@unspent\/drip/,
				/@unspent\/wallet/,
				/@unspent\/wrap/,
				/node_modules/
			]
		},

		sourcemap: true,
		rollupOptions: {
			output: {
				name: 'app',
				globals: {
					events: 'undefined'
				},

			},
			context: 'window'
		}
	},
	worker: {
		format: 'es'
	}

});
