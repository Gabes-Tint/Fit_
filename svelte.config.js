import adapter from '@sveltejs/adapter-node';
import adapterStatic from '@sveltejs/adapter-static';

export default {
	compilerOptions: {
		// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
		runes: ({ filename }) => (filename.split(/[/\\]/).includes('node_modules') ? undefined : true)
	},

	kit: {
		version:
			process.env.FIT_BUNDLE_MEASURE_VERSION === undefined
				? undefined
				: {
						// During measurement builds, pin `kit.version.name` to a fixed string
						// so SvelteKit's `__sveltekit_<token>` identifier hashes consistently
						// and produces the same token length every build. Without this, the
						// token varies in length (6–7 chars), and its 4 occurrences sum to
						// measurement noise. The real build never sets this env var and keeps
						// the default `Date.now().toString()`, preserving version-skew detection.
						name: 'fit-measurement-build'
					},

		// Pinned so `bun run build` proves a deployable artifact rather than
		// succeeding while adapting to nothing. A consuming app may swap this
		// for its own target: https://svelte.dev/docs/kit/adapters
		//
		// The Capacitor target is the one exception: a WebView has no Node to
		// run a server bundle, so that build emits a static SPA into its own
		// directory. Both are real artifacts; neither adapts to nothing.
		adapter: process.env.VITE_CAPACITOR
			? adapterStatic({
					pages: 'build-capacitor',
					assets: 'build-capacitor',
					fallback: 'index.html',
					precompress: false
				})
			: adapter()
	}
};
