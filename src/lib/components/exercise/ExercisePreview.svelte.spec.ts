import { describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import { libraryExercise } from '$lib/domain/exercises';
import ExercisePreview from './ExercisePreview.svelte';

const EXERCISE_NAME = 'Bench Press';

async function renderPreview() {
	const exercise = libraryExercise(EXERCISE_NAME);
	await render(ExercisePreview, { props: { exercise } });
}

describe('ExercisePreview', () => {
	it('renders an element with accessible name Exercise preview', async () => {
		await renderPreview();
		await expect
			.element(page.getByRole('region', { name: 'Exercise preview' }))
			.toBeInTheDocument();
	});

	it('shows the exact domain-formatted label', async () => {
		await renderPreview();
		const exercise = libraryExercise(EXERCISE_NAME);
		await expect
			.element(page.getByText(`${exercise?.name} (${exercise?.group})`))
			.toBeInTheDocument();
	});
});
