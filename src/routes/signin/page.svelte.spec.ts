import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import { session } from '$lib/state/session.svelte';
import { signedInSession } from '$lib/testing/fixtures';
import SignInPage from './+page.svelte';

const goto = vi.hoisted(() => vi.fn());
vi.mock('$app/navigation', () => ({ goto }));

/**
 * The address of the form, which now carries where to go back to. Mocked so
 * `?next=` can be set per test; the page reads nothing else from it.
 */
const location = vi.hoisted(() => ({ current: new URL('http://localhost/signin') }));
vi.mock('$app/state', () => ({
	page: {
		get url() {
			return location.current;
		}
	}
}));

/** The session endpoint the page asks on mount, kept out of every other test's way. */
const CURRENT = '/api/sessions/current';

type Sent = { path: string; body: Record<string, string> };

function pathOf(input: string | URL | Request): string {
	if (typeof input === 'string') return input;
	return input instanceof URL ? input.pathname : new URL(input.url).pathname;
}

/**
 * Answer the form's own request, and refuse the one the page makes on mount.
 *
 * That mount request asks whether this device already holds a session the
 * browser cannot see, and it would otherwise be handed whatever a test canned
 * for the submission — signing the page in before it was filled in, and taking
 * first place in `sent`.
 */
function answer(body: unknown, status: number, headers: Record<string, string> = {}): Sent[] {
	const sent: Sent[] = [];
	vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
		if (pathOf(input) === CURRENT) return Promise.resolve(new Response(null, { status: 401 }));
		sent.push({
			path: pathOf(input),
			body: typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, string>) : {}
		});
		return Promise.resolve(
			new Response(JSON.stringify(body), {
				status,
				headers: { 'content-type': 'application/json', ...headers }
			})
		);
	});
	return sent;
}

const SESSION = signedInSession();

async function open() {
	await render(SignInPage);
}

async function fillIn(name = 'robin', secret = 'a-long-password') {
	await page.getByLabelText('Username').fill(name);
	await page.getByLabelText('Password').fill(secret);
}

function submit() {
	return page.getByRole('button', { name: 'Sign in' }).click();
}

beforeEach(() => {
	location.current = new URL('http://localhost/signin');
	goto.mockClear();
	localStorage.clear();
	session.current = null;
	session.hydrated = false;
	// Rendering the page asks the server about this device. Refused by default,
	// which is the answer for the visitor this form is for.
	vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 401 }));
});

afterEach(() => {
	vi.restoreAllMocks();
	goto.mockClear();
});

describe('sign-in page', () => {
	it('asks for a username and a password', async () => {
		await open();
		await expect.element(page.getByLabelText('Username')).toBeInTheDocument();
		await expect.element(page.getByLabelText('Password')).toBeInTheDocument();
	});

	it('signs in at the sessions endpoint', async () => {
		const sent = answer(SESSION, 200);
		await open();
		await fillIn();
		await submit();
		await vi.waitFor(() => expect(sent[0]?.path).toBe('/api/sessions'));
	});

	/**
	 * The session's device label is derived from the request's own `User-Agent`
	 * on the server, so the form has nothing to say about it and this page must
	 * not start sending one again.
	 */
	it('sends the credentials and nothing else', async () => {
		const sent = answer(SESSION, 200);
		await open();
		await fillIn();
		await submit();
		await vi.waitFor(() =>
			expect(sent[0]?.body).toEqual({ username: 'robin', password: 'a-long-password' })
		);
	});

	it('remembers the account it signed in as', async () => {
		answer(SESSION, 200);
		await open();
		await fillIn();
		await submit();
		await vi.waitFor(() => expect(session.account?.username).toBe('robin'));
	});

	it('sends someone who has signed in to their journal', async () => {
		answer(SESSION, 200);
		await open();
		await fillIn();
		await submit();
		await vi.waitFor(() => expect(goto).toHaveBeenCalledWith('/'));
	});

	it('returns to the page the gate turned away', async () => {
		location.current = new URL('http://localhost/signin?next=%2Fexercise');
		answer(SESSION, 200);
		await open();
		await fillIn();
		await submit();
		await vi.waitFor(() => expect(goto).toHaveBeenCalledWith('/exercise'));
	});

	it('refuses to be pointed at another origin', async () => {
		// The parameter arrives in a URL anybody can write, and following an
		// absolute one would make this form an open redirect.
		location.current = new URL('http://localhost/signin?next=https%3A%2F%2Fevil.example');
		answer(SESSION, 200);
		await open();
		await fillIn();
		await submit();
		await vi.waitFor(() => expect(goto).toHaveBeenCalledWith('/'));
	});

	it('lets in a device whose session the server still holds', async () => {
		// The credential is a cookie no script can read, so a browser with its
		// storage cleared arrives here holding a session it cannot see. Asking is
		// the only way to find out, and the answer is a way in.
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(
			new Response(JSON.stringify(SESSION), {
				status: 200,
				headers: { 'content-type': 'application/json' }
			})
		);
		await open();
		await vi.waitFor(() => expect(goto).toHaveBeenCalledWith('/'));
	});

	it('leaves the form standing when the server holds no such session', async () => {
		await open();
		await expect.element(page.getByLabelText('Username')).toBeInTheDocument();
		expect(goto).not.toHaveBeenCalled();
	});

	it('says the same thing for a wrong name as for a wrong password', async () => {
		answer({ error: { code: 'invalid-credentials' } }, 401);
		await open();
		await fillIn();
		await submit();
		await expect
			.element(page.getByRole('alert'))
			.toHaveTextContent('That username and password don’t match.');
	});

	it('names neither box for a refused credential, because the server did not', async () => {
		answer({ error: { code: 'invalid-credentials' } }, 401);
		await open();
		await fillIn();
		await submit();
		await expect.element(page.getByRole('alert')).toBeInTheDocument();
		await expect
			.element(page.getByLabelText('Username'))
			.not.toHaveAttribute('aria-invalid', 'true');
	});

	it('signs nobody in when the credential was refused', async () => {
		answer({ error: { code: 'invalid-credentials' } }, 401);
		await open();
		await fillIn();
		await submit();
		await expect.element(page.getByRole('alert')).toBeInTheDocument();
		expect(session.signedIn).toBe(false);
	});

	it('says how long the throttle is holding, using Retry-After', async () => {
		answer({ error: { code: 'too-many-attempts' } }, 429, { 'retry-after': '45' });
		await open();
		await fillIn();
		await submit();
		await expect.element(page.getByRole('alert')).toHaveTextContent('45 seconds');
	});

	it('turns a long wait into minutes rather than a number to do arithmetic on', async () => {
		answer({ error: { code: 'too-many-attempts' } }, 429, { 'retry-after': '154' });
		await open();
		await fillIn();
		await submit();
		await expect.element(page.getByRole('alert')).toHaveTextContent('3 minutes');
	});

	it('stops the button while the throttle is holding', async () => {
		answer({ error: { code: 'too-many-attempts' } }, 429, { 'retry-after': '45' });
		await open();
		await fillIn();
		await submit();
		await expect.element(page.getByRole('button', { name: 'Sign in' })).toBeDisabled();
	});

	it('counts the wait down rather than leaving a sentence that stops being true', async () => {
		answer({ error: { code: 'too-many-attempts' } }, 429, { 'retry-after': '2' });
		await open();
		await fillIn();
		await submit();
		await expect.element(page.getByRole('alert')).toHaveTextContent('2 seconds');
		await vi.waitFor(
			async () => {
				await expect.element(page.getByRole('alert')).toHaveTextContent('The wait is over');
			},
			{ timeout: 5000 }
		);
	});

	it('lets the button work again once the wait is over', async () => {
		answer({ error: { code: 'too-many-attempts' } }, 429, { 'retry-after': '1' });
		await open();
		await fillIn();
		await submit();
		await vi.waitFor(
			async () => {
				await expect.element(page.getByRole('button', { name: 'Sign in' })).toBeEnabled();
			},
			{ timeout: 5000 }
		);
	});

	it('still says something useful when the throttle sent no header to count', async () => {
		answer({ error: { code: 'too-many-attempts' } }, 429);
		await open();
		await fillIn();
		await submit();
		await expect.element(page.getByRole('alert')).toHaveTextContent('Try again shortly.');
	});

	it('separates a server it could not reach from a credential it refused', async () => {
		vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
		await open();
		await fillIn();
		await submit();
		await expect.element(page.getByRole('alert')).toHaveTextContent('Couldn’t reach the server');
	});

	// A stale session (signed out from another device) must not hide the form.
	it('shows the form even when this device still holds a session record', async () => {
		session.begin(SESSION);
		await open();
		await expect.element(page.getByLabelText('Username')).toBeInTheDocument();
		await expect.element(page.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
	});

	it('offers the way to the sign-up form', async () => {
		await open();
		await expect
			.element(page.getByRole('link', { name: 'Create one' }))
			.toHaveAttribute('href', '/signup');
	});
});
