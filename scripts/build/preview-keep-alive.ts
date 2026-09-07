import type { Server } from 'node:http';
import type { Plugin } from 'vite';

/**
 * Stop the preview server from closing keep-alive connections its own client
 * is still holding.
 *
 * Node closes an idle keep-alive connection `keepAliveTimeout` after it answers
 * — 5 s by default, ~6 s as observed on the wire — and `vite preview` leaves
 * that default in place. The end-to-end suite's client does not agree: every
 * `APIRequestContext` in a Playwright worker shares one module-level
 * `new HttpHappyEyeballsAgent({ keepAlive: true })`, whose pool has no idle
 * timeout of its own, so it goes on offering a socket the server has already
 * decided to drop. Measured: ten `page.request.post` calls open one TCP
 * connection, and the server closes that connection 6.0 s after the last
 * response.
 *
 * Those two numbers meet in this suite. A test's only API call is the
 * account-setup POST in its `beforeEach`; everything after it is browser-side,
 * so the pooled socket sits idle for as long as the test takes to finish, and a
 * mobile-safari test takes 4-7 s. The socket is therefore closed and reopened
 * between most tests, and almost always cleanly — the client sees the FIN and
 * dials again. When the close and the next write cross on the wire it does not:
 * the request goes out on a socket that is already gone, and Node does not
 * retry a POST that dies on a reused socket, so the failure surfaces as
 * `apiRequestContext.post: socket hang up` on the first call of a test. That is
 * issue #125, where the test before the failing one ran 6.5 s.
 *
 * Zero means "never close an idle connection", which removes the crossing
 * rather than making it rarer — any finite value just moves the boundary the
 * client can still lose against. This is safe here because the server's life is
 * one worker's test run and its client count is one; `stop()` in
 * `tests/preview-server.ts` ends it either way.
 *
 * `headersTimeout` is deliberately left alone. It does not close idle
 * keep-alive connections (it starts counting when a request's first byte
 * arrives), so it costs nothing here and still refuses a client that opens a
 * connection and dribbles its headers.
 */
export function holdKeepAliveConnections(httpServer: Server): void {
	httpServer.keepAliveTimeout = 0;
}

/** Wires the above into `vite preview`, which is what the end-to-end suite runs. */
export function previewKeepAlive(): Plugin {
	return {
		name: 'fit-preview-keep-alive',
		configurePreviewServer(server) {
			holdKeepAliveConnections(server.httpServer);
		}
	};
}
