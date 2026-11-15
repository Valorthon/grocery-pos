// Test-only helper for the real-MongoDB single-PC suites (#366): each
// suite waits until the installation ports are free before it starts and
// after it stops its services, so a slow mongod/API shutdown from one suite
// or test can never be mistaken for the next one's service. Named
// *.test.mjs so the bundle never ships it; it defines no tests.
import { connect } from 'node:net';
import { PORTS, LOOPBACK } from './layout.mjs';

function listening(port) {
    return new Promise((done) => {
        const socket = connect({ host: LOOPBACK, port });
        socket.setTimeout(1000);
        socket.once('connect', () => {
            socket.destroy();
            done(true);
        });
        socket.once('timeout', () => {
            socket.destroy();
            done(true);
        });
        socket.once('error', () => done(false));
    });
}

/** Resolves once nothing listens on the MongoDB and API ports. */
export async function waitPortsFree(
    ports = [PORTS.mongo, PORTS.api],
    { timeoutMs = 60000 } = {},
) {
    const end = Date.now() + timeoutMs;
    for (;;) {
        const busy = [];
        for (const port of ports) if (await listening(port)) busy.push(port);
        if (!busy.length) return;
        if (Date.now() > end)
            throw new Error(
                `Ports still in use after ${timeoutMs} ms: ${busy.join(', ')}.`,
            );
        await new Promise((r) => setTimeout(r, 250));
    }
}
