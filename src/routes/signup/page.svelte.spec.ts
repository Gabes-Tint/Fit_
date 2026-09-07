import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import { session } from '$lib/state/session.svelte';
import { signedInSession } from '$lib/testing/fixtures';
import SignUpPage from './+page.svelte';

// goto is mocked: the harness renders only this page, and the redirect target is under test.
const goto = vi.hoisted(() => vi.fn());
vi.mock('$app/navigation', () => ({ goto }));

type Sent = { path: string; body: Record<string, string> };

function pathOf(input: string | URL | Request): string {
	if (typeof input === 'string') return input;
	return input instanceof URL ? input.pathname : new URL(input.url).pathname;
}

function answer(body: unknown, status: number): Sent[] {
	const sent: Sent[] = [];
	vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
		sent.push({
			path: pathOf(input),
			body: typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, string>) : {}
		});
		return Promise.resolve(
			new Response(JSON.stringify(body), {
				status,
				headers: { 'content-type': 'application/json' }
			})
		);
	});
	return sent;
}

const CREATED = signedInSession();

async function open() {
	await render(SignUpPage);
}

async function fillIn(name: string, display: string, secret: string) {
	await page.getByLabelText('Username').fill(name);
	await page.getByLabelText('Name', { exact: true }).fill(display);
	await page.getByLabelText('Password').fill(secret);
}

async function create() {
	await page.getByRole('button', { name: 'Create account' }).click();
}

beforeEach(() => {
	localStorage.clear();
	session.current = null;
	session.hydrated = false;
});

afterEach(() => {
	vi.restoreAllMocks();
	goto.mockClear();
});

describe('sign-up page', () => {
	it('asks for a username', async () => {
		await open();
		await expect.element(page.getByLabelText('Username')).toBeInTheDocument();
	});

	it('says what a username may hold, before anyone gets it wrong', async () => {
		await open();
		await expect.element(page.getByText('3 to 32 characters')).toBeInTheDocument();
	});

	it('says how long a password has to be', async () => {
		await open();
		await expect.element(page.getByText('At least 10 characters')).toBeInTheDocument();
	});

	it('registers at the accounts endpoint', async () => {
		const sent = answer(CREATED, 201);
		await open();
		await fillIn('robin', 'Robin', 'a-long-password');
		await create();
		await vi.waitFor(() => expect(sent[0]?.path).toBe('/api/accounts'));
	});

	it('sends what was typed', async () => {
		const sent = answer(CREATED, 201);
		await open();
		await fillIn('robin', 'Robin', 'a-long-password');
		await create();
		await vi.waitFor(() =>
			expect(sent[0]?.body).toMatchObject({
				username: 'robin',
				displayName: 'Robin',
				password: 'a-long-password'
			})
		);
	});

	it('names the household after the person, with no input for it', async () => {
		const sent = answer(CREATED, 201);
		await open();
		await fillIn('robin', 'Robin', 'a-long-password');
		await create();
		await vi.waitFor(() => expect(sent[0]?.body.householdName).toBe('Robin'));
	});

	it('renders no Household input field', async () => {
		await open();
		await expect.element(page.getByLabelText('Household')).not.toBeInTheDocument();
	});

	it('remembers the account it just created', async () => {
		answer(CREATED, 201);
		await open();
		await fillIn('robin', 'Robin', 'a-long-password');
		await create();
		await vi.waitFor(() => expect(session.account?.username).toBe('robin'));
	});

	it('sends someone who has registered to their journal', async () => {
		answer(CREATED, 201);
		await open();
		await fillIn('robin', 'Robin', 'a-long-password');
		await create();
		await vi.waitFor(() => expect(goto).toHaveBeenCalledWith('/'));
	});

	it('puts a taken username under the username, where the correction is made', async () => {
		answer({ error: { code: 'username-taken', field: 'username' } }, 409);
		await open();
		await fillIn('robin', 'Robin', 'a-long-password');
		await create();
		await expect.element(page.getByText('That username is taken.')).toBeInTheDocument();
	});

	it('marks the username invalid when it is taken', async () => {
		answer({ error: { code: 'username-taken', field: 'username' } }, 409);
		await open();
		await fillIn('robin', 'Robin', 'a-long-password');
		await create();
		await expect.element(page.getByLabelText('Username')).toHaveAttribute('aria-invalid', 'true');
	});

	it('signs nobody in when registration was refused', async () => {
		answer({ error: { code: 'username-taken', field: 'username' } }, 409);
		await open();
		await fillIn('robin', 'Robin', 'a-long-password');
		await create();
		await expect.element(page.getByText('That username is taken.')).toBeInTheDocument();
		expect(session.signedIn).toBe(false);
	});

	it('puts a rejected password under the password', async () => {
		answer({ error: { code: 'invalid-input', field: 'password', reason: 'too-short' } }, 400);
		await open();
		await fillIn('robin', 'Robin', 'short');
		await create();
		await expect.element(page.getByLabelText('Password')).toHaveAttribute('aria-invalid', 'true');
	});

	it('puts an unusable name under the name', async () => {
		answer(
			{ error: { code: 'invalid-input', field: 'displayName', reason: 'unsafe-characters' } },
			400
		);
		await open();
		await fillIn('robin', 'Robin', 'a-long-password');
		await create();
		await expect
			.element(page.getByText('Remove any invisible or control characters.'))
			.toBeInTheDocument();
	});

	it('says a server it could not reach is a connection problem, not a refusal', async () => {
		vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
		await open();
		await fillIn('robin', 'Robin', 'a-long-password');
		await create();
		await expect.element(page.getByRole('alert')).toHaveTextContent('Couldn’t reach the server');
	});

	it('shows the form even when this device still holds a session record', async () => {
		session.begin(CREATED);
		await open();
		await expect.element(page.getByLabelText('Username')).toBeInTheDocument();
		await expect.element(page.getByRole('button', { name: 'Create account' })).toBeInTheDocument();
	});

	it('offers the way to the sign-in form', async () => {
		await open();
		await expect
			.element(page.getByRole('link', { name: 'Sign in' }))
			.toHaveAttribute('href', '/signin');
	});
});
