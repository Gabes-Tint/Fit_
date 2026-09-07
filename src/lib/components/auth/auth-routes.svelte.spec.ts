import { describe, expect, it } from 'vitest';
import { AUTH_ROUTES, returnPath, signInPath } from './auth-routes';

/** The address this app is being served from, as the sign-in page reads it. */
const ORIGIN = 'http://app.local';

describe('AUTH_ROUTES', () => {
	it('lets an unauthenticated visitor reach the form', () => {
		expect(AUTH_ROUTES).toContain('/signin');
	});

	it('lets them reach the one that creates an account', () => {
		expect(AUTH_ROUTES).toContain('/signup');
	});

	it('opens nothing else', () => {
		expect(AUTH_ROUTES).toHaveLength(2);
	});
});

describe('signInPath', () => {
	it('is the bare form when the front page is what was asked for', () => {
		// The home page is the default on the other side, so saying it would be
		// noise in the address bar for the commonest case there is.
		expect(signInPath('/')).toBe('/signin');
	});

	it('names the destination that was turned away', () => {
		expect(signInPath('/progress')).toBe(`/signin?next=${encodeURIComponent('/progress')}`);
	});

	it('encodes the path, so its slashes stay inside the parameter', () => {
		// Unencoded, `/exercise/session` would end the parameter at the first
		// slash and the page would come back to somewhere else entirely.
		expect(signInPath('/exercise/session')).toBe(
			`/signin?next=${encodeURIComponent('/exercise/session')}`
		);
	});

	it('encodes a query too, so it cannot become a second parameter', () => {
		expect(signInPath('/exercise/plan?week=3')).toBe(
			`/signin?next=${encodeURIComponent('/exercise/plan?week=3')}`
		);
	});

	it('survives a round trip through the rule that reads it back', () => {
		const path = '/exercise/routines/r-1?edit=1';
		const next = new URL(signInPath(path), ORIGIN).searchParams.get('next');
		expect(returnPath(next, ORIGIN)).toBe(path);
	});
});

describe('returnPath', () => {
	it('goes to the front page when the gate sent nobody', () => {
		expect(returnPath(null, ORIGIN)).toBe('/');
	});

	it('returns to the page that was gated', () => {
		expect(returnPath('/exercise', ORIGIN)).toBe('/exercise');
	});

	it('keeps the query the gated page carried', () => {
		expect(returnPath('/plan?week=3', ORIGIN)).toBe('/plan?week=3');
	});

	it('refuses another origin written as a protocol-relative path', () => {
		// `//evil.example` is absolute, and following it would make the sign-in
		// page an open redirect for anybody who could hand someone a link.
		expect(returnPath('//evil.example/steal', ORIGIN)).toBe('/');
	});

	it('refuses an absolute URL', () => {
		expect(returnPath('https://evil.example/steal', ORIGIN)).toBe('/');
	});

	it('refuses the backslash spelling of another origin', () => {
		// `/\host` is not a path. The URL parser treats the backslash as a slash
		// for http and https, so this resolves to another origin exactly as
		// `//evil.example` does — which the assertion below states outright,
		// because the whole point of the rule is what the browser will do with it.
		expect(new URL('/\\evil.example/steal', ORIGIN).origin).toBe('http://evil.example');
		expect(returnPath('/\\evil.example/steal', ORIGIN)).toBe('/');
	});

	it('refuses a scheme, which is not a destination on this origin', () => {
		// Parsed rather than pattern-matched, so a scheme nobody thought to list
		// is still answered correctly: it has an origin, and it is not this one.
		expect(returnPath('javascript:alert(1)', ORIGIN)).toBe('/');
	});

	it('reads a scheme written after a slash as the path it is', () => {
		// `/javascript:...` is a path on this origin whose first segment happens
		// to contain a colon. It leads to the app's own not-found page, which is
		// what any address naming no route does, and nothing is executed.
		expect(returnPath('/javascript:alert(1)', ORIGIN)).toBe('/javascript:alert(1)');
	});

	it('normalizes the path it hands back', () => {
		// `/a/../b` is `/b` to the browser, so it is `/b` here too rather than a
		// string every later comparison would have to know how to fold.
		expect(returnPath('/exercise/../plan', ORIGIN)).toBe('/plan');
	});

	it('cannot be walked above the root', () => {
		// The parser clamps the climb, so this stays on this origin instead of
		// reaching for something outside it. It names no route, so it lands on
		// the not-found page.
		expect(returnPath('/../../etc/passwd', ORIGIN)).toBe('/etc/passwd');
	});

	it('answers rather than throws when the origin is unusable', () => {
		// The origin is read from the page's own address, so this should not
		// happen — but a parse failure inside a redirect rule must not become an
		// exception thrown at whoever asked where to go. There is one sensible
		// answer to an unanswerable question, and it is the front page.
		expect(returnPath('/plan', 'not-an-origin')).toBe('/');
	});

	it('refuses a relative path, which does not say where it starts', () => {
		// The parser would read this as `/exercise`, and guessing at a link that
		// did not say is how an unintended address gets followed.
		expect(returnPath('exercise', ORIGIN)).toBe('/');
	});

	it('minds where the value points, not what its query carries', () => {
		// The query belongs to a destination on this origin. A rule that went
		// looking for `//` anywhere in the string would refuse it.
		const path = '/plan?source=https://example.com/list';
		expect(returnPath(path, ORIGIN)).toBe(path);
	});

	it('refuses to bounce back to the form just cleared', () => {
		expect(returnPath('/signin', ORIGIN)).toBe('/');
	});

	it('refuses the sign-up form too, query and all', () => {
		expect(returnPath('/signup?next=%2F', ORIGIN)).toBe('/');
	});

	it('refuses the sign-in form wearing a fragment', () => {
		// The worse half of the same rule: arriving at `/signin#x` is a navigation
		// within the route already on screen, so the page is not remounted and the
		// check that moves a signed-in visitor on never runs a second time.
		expect(returnPath('/signin#x', ORIGIN)).toBe('/');
	});

	it('keeps a fragment on a page that is not the form', () => {
		expect(returnPath('/exercise/session#set-3', ORIGIN)).toBe('/exercise/session#set-3');
	});
});
