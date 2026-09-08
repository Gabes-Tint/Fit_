import { createServer, type Server } from 'node:http';
import { connect, type Socket } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import type { Plugin } from 'vite';
import viteConfig from '../../vite.config';
import { holdKeepAliveConnections, previewKeepAlive } from './preview-keep-alive';

/**
 * The defect is a socket the server closed while its client still had it
 * pooled, so this asserts on a real socket against a real server rather than on
 * a property. A stock server runs alongside the held one and its own close is
 * the clock: when Node drops the stock connection the idle window has passed,
 * and the held connection is asked whether it survived it.
 *
 * The held connection is opened first, so its idle window starts earlier than
 * the stock one's, and the assertion waits a further `GRACE_MS` after the stock
 * close before reading it. Both matter: Node sweeps its idle connections on a
 * coarse timer, so two servers started milliseconds apart drop their sockets in
 * the same sweep and in no guaranteed order. Reading the held socket at the
 * instant the stock one closed passed against an unfixed server; reading it two
 * seconds later does not. The passing side has no timing sensitivity at all,
 * because a held connection is never closed.
 *
 * Nothing hard-codes Node's 5 s default, and if Node ever stops closing idle
 * connections the stock socket never closes and this fails on its timeout
 * rather than passing on a premise that no longer holds.
 */

/** Longer than the spread between two servers' idle sweeps, far shorter than the timeout. */
const GRACE_MS = 2_000;

const servers: Server[] = [];
const sockets: Socket[] = [];

afterEach(() => {
	for (const socket of sockets.splice(0)) socket.destroy();
	for (const server of servers.splice(0)) {
		server.closeAllConnections();
		server.close();
	}
});

/** A server that answers anything, so the socket reaches its idle keep-alive state. */
async function serve(hold: boolean): Promise<number> {
	const server = createServer((request, response) => {
		request.resume();
		request.on('end', () => response.end('ok'));
	});
	servers.push(server);
	if (hold) holdKeepAliveConnections(server);
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	const address = server.address();
	if (address === null || typeof address === 'string') throw new Error('Server has no port.');
	return address.port;
}

/** One keep-alive request, then nothing but waiting to be closed. */
function idleAfterOneRequest(port: number): { closed: () => boolean; wasClosed: Promise<void> } {
	const socket = connect(port, '127.0.0.1');
	sockets.push(socket);
	let closed = false;
	socket.on('connect', () =>
		socket.write('GET / HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: keep-alive\r\n\r\n')
	);
	socket.on('data', () => {});
	socket.on('error', () => {});
	const wasClosed = new Promise<void>((resolve) =>
		socket.on('close', () => {
			closed = true;
			resolve();
		})
	);
	return { closed: () => closed, wasClosed };
}

describe('the preview server and the connections its client pools', () => {
	it(
		'keeps an idle keep-alive connection that a stock server would have dropped',
		{ timeout: 30_000 },
		async () => {
			const heldPort = await serve(true);
			const stockPort = await serve(false);
			// Held first: its idle window opens before the stock one's, so an
			// unfixed server would drop it before the clock below even strikes.
			const held = idleAfterOneRequest(heldPort);
			const stock = idleAfterOneRequest(stockPort);

			await stock.wasClosed;
			await new Promise((resolve) => setTimeout(resolve, GRACE_MS));

			expect(held.closed()).toBe(false);
		}
	);

	it('applies the hold through the hook vite preview calls', async () => {
		const server = createServer();
		servers.push(server);
		const hook = previewKeepAlive().configurePreviewServer;
		if (typeof hook !== 'function') throw new Error('configurePreviewServer is not a function.');

		await hook.call({} as never, { httpServer: server } as never);

		expect(server.keepAliveTimeout).toBe(0);
	});

	/**
	 * The two cases above prove the plugin holds a connection when it runs. What
	 * makes it run is one line in `vite.config.ts`, and nothing else in the suite
	 * reads it: delete `previewKeepAlive()` from the plugins array and every other
	 * assertion here still passes, while the end-to-end suite goes back to losing
	 * an account-setup POST to a socket the server closed underneath it. That
	 * failure is a flake on the slowest shard once a night, which is how #125 cost
	 * five sightings before anyone could name it. So the wiring is asserted too.
	 */
	it('is wired into the config vite preview actually loads', () => {
		const plugins = (viteConfig.plugins ?? []).flat(Infinity) as Plugin[];

		expect(plugins.map((plugin) => plugin?.name)).toContain('fit-preview-keep-alive');
	});

	it('leaves the headers timeout in place, since it does not close idle connections', () => {
		const server = createServer();
		servers.push(server);
		const stockHeadersTimeout = server.headersTimeout;

		holdKeepAliveConnections(server);

		expect(server.headersTimeout).toBe(stockHeadersTimeout);
	});
});
