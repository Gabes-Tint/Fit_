import prettier from 'eslint-config-prettier';
import path from 'node:path';
import js from '@eslint/js';
import vitest from '@vitest/eslint-plugin';
import playwright from 'eslint-plugin-playwright';
import svelte from 'eslint-plugin-svelte';
import { defineConfig, includeIgnoreFile } from 'eslint/config';
import globals from 'globals';
import ts from 'typescript-eslint';

const gitignorePath = path.resolve(import.meta.dirname, '.gitignore');

export default defineConfig(
	includeIgnoreFile(gitignorePath),
	// Built web assets in the Android project; root `.gitignore` doesn't cover them.
	// `/build/**` and `/.svelte-kit/**` are anchored to the repo root — unanchored
	// `build/**` would also swallow the real, tracked scripts/build/*.ts sources.
	//
	// Nothing is listed here for `.claude/worktrees/`, which holds a full second
	// checkout per agent and would multiply this type-aware run by the number of
	// them. It does not need to be: `includeIgnoreFile` above brings in
	// `.gitignore`, which ignores that directory, and ESLint prunes an ignored
	// directory instead of walking into it — so the generated `.svelte-kit` and
	// `build` output inside a worktree never comes up either, anchors or not.
	// Checked in #198 by counting what ESLint reports: 527 files, none of them
	// under `.claude/`.
	{ ignores: ['android/**', '/build/**', '/.svelte-kit/**'] },
	js.configs.recommended,
	ts.configs.recommendedTypeChecked,
	svelte.configs.recommended,
	prettier,
	svelte.configs.prettier,
	{
		linterOptions: {
			reportUnusedDisableDirectives: 'error',
			reportUnusedInlineConfigs: 'error'
		},
		languageOptions: {
			globals: { ...globals.browser, ...globals.node },
			// No tsconfig owns these; `allowDefaultProject` still gets them type-aware linting.
			parserOptions: {
				projectService: {
					allowDefaultProject: ['capacitor.config.ts', 'vitest-setup-client-node.ts']
				}
			}
		},
		rules: {
			// typescript-eslint strongly recommend that you do not use the no-undef lint rule on TypeScript projects.
			// see: https://typescript-eslint.io/troubleshooting/faqs/eslint/#i-get-errors-from-the-no-undef-rule-about-global-variables-not-being-defined-even-though-there-are-no-typescript-errors
			'no-undef': 'off',
			'@typescript-eslint/consistent-type-imports': 'error',
			'@typescript-eslint/no-explicit-any': 'error',
			'@typescript-eslint/no-non-null-assertion': 'error',
			'@typescript-eslint/switch-exhaustiveness-check': 'error',
			'svelte/button-has-type': 'error',
			'svelte/no-target-blank': 'error'
		}
	},
	{
		files: ['**/*.{js,mjs}', 'playwright.config.ts'],
		...ts.configs.disableTypeChecked
	},
	{
		files: ['**/*.svelte', '**/*.svelte.ts', '**/*.svelte.js'],
		languageOptions: {
			parserOptions: {
				projectService: true,
				extraFileExtensions: ['.svelte'],
				parser: ts.parser
			}
		}
	},
	{
		files: ['src/**/*.{js,ts,svelte}'],
		ignores: ['src/**/*.{test,spec}.{js,ts}', 'src/**/*.svelte.{test,spec}.{js,ts}'],
		rules: {
			complexity: ['error', 10],
			'max-depth': ['error', 4],
			'max-params': ['error', 4]
		}
	},
	{
		files: ['src/**/*.{test,spec}.{js,ts}', 'src/**/*.svelte.{test,spec}.{js,ts}'],
		...vitest.configs.recommended,
		rules: {
			...vitest.configs.recommended.rules,
			'vitest/no-commented-out-tests': 'error',
			'vitest/no-disabled-tests': 'error',
			'vitest/no-focused-tests': 'error',
			'vitest/warn-todo': 'error'
		}
	},
	{
		// Playwright derives a fixture's dependencies from the destructuring
		// pattern of its first parameter, so a fixture that depends on nothing is
		// written `async ({}, use)`. That is the runner's interface, not a
		// mistake, and `no-empty-pattern` has an option for exactly it.
		files: ['tests/preview-server.ts'],
		rules: {
			'no-empty-pattern': ['error', { allowObjectPatternsAsParameters: true }]
		}
	},
	{
		files: ['**/*.e2e.{js,ts}'],
		...playwright.configs['flat/recommended'],
		rules: {
			...playwright.configs['flat/recommended'].rules,
			'playwright/no-focused-test': 'error',
			'playwright/no-skipped-test': 'error',
			// expectFitsViewport (tests/e2e-support.ts) wraps its own `expect` calls, so a
			// test whose only assertion is the layout check reads as assertion-free to the
			// rule's static scan without naming it here too. #152.
			// expectToggleAndCardActionsHittable (phone-layout.e2e.ts) is the same
			// shape one level deeper: it wraps expectHittable/expectCentreHittable,
			// which themselves wrap `expect`, so the left-handed sweep's own
			// assertions are inside it rather than in the test body.
			'playwright/expect-expect': [
				'warn',
				{
					assertFunctionNames: [
						'expect',
						'expectFitsViewport',
						'expectToggleAndCardActionsHittable',
						'assertToggleOnTopOfDrawer'
					]
				}
			]
		}
	}
);
