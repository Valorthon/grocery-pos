import type { Connection } from 'mongoose';
import {
    assertDataVersion,
    awaitDatabaseReady,
    connectionRetryOptions,
    DatabaseNotReadyError,
    dataVersionProblem,
    DataVersionMismatchError,
} from './startup-readiness';

describe('data-version gate (#364)', () => {
    function connection(marker: unknown, db = true): Connection {
        const findOne = jest.fn().mockResolvedValue(marker);
        const collection = jest.fn(() => ({ findOne }));
        return {
            db: db ? { collection } : undefined,
        } as unknown as Connection;
    }

    it('starts on its own version, and on no marker for version 1', async () => {
        await expect(
            assertDataVersion(
                connection({ dataVersion: 3, state: 'ready' }),
                3,
                'c',
                'data',
            ),
        ).resolves.toBeUndefined();
        await expect(
            assertDataVersion(connection(null), 1, 'c', 'data'),
        ).resolves.toBeUndefined();
    });

    it.each([
        [
            { dataVersion: 2, state: 'ready' },
            1,
            /data version 2; this release needs 1/,
        ],
        [
            { dataVersion: 1, state: 'ready' },
            2,
            /data version 1; this release needs 2/,
        ],
        [null, 2, /data version 1; this release needs 2/],
        [{ dataVersion: 2, state: 'migrating' }, 2, /being upgraded/],
    ])(
        'refuses %j for release version %d',
        async (marker, expected, message) => {
            const run = () =>
                assertDataVersion(connection(marker), expected, 'c', 'data');
            await expect(run()).rejects.toThrow(message);
            await expect(run()).rejects.toBeInstanceOf(
                DataVersionMismatchError,
            );
        },
    );

    it('refuses without a database handle', async () => {
        await expect(
            assertDataVersion(connection(null, false), 1, 'c', 'data'),
        ).rejects.toThrow(/No database connection/);
    });

    it('is satisfied only by the ready state and the exact number', () => {
        expect(
            dataVersionProblem({ dataVersion: 1, state: 'ready' }, 1),
        ).toBeNull();
        expect(
            dataVersionProblem({ dataVersion: '1', state: 'ready' }, 1),
        ).not.toBeNull();
    });
});

function fakeConnection(answers: unknown[], models = 2) {
    const command = jest.fn();
    for (const answer of answers)
        if (answer instanceof Error) command.mockRejectedValueOnce(answer);
        else command.mockResolvedValueOnce(answer);
    const inits = Array.from({ length: models }, () =>
        jest.fn().mockResolvedValue(undefined),
    );
    const connection = {
        db: { admin: () => ({ command }) },
        models: Object.fromEntries(inits.map((init, i) => [`M${i}`, { init }])),
    } as unknown as Connection;
    return { connection, command, inits };
}

function fastClock() {
    let t = 0;
    return {
        now: () => t,
        sleep: (ms: number) => {
            t += ms;
            return Promise.resolve();
        },
    };
}

describe('awaitDatabaseReady (#360)', () => {
    it('waits for a writable replica-set primary, then builds every model index', async () => {
        const { connection, command, inits } = fakeConnection([
            new Error('not yet'),
            { isWritablePrimary: false, setName: 'gpos' },
            { isWritablePrimary: true },
            { isWritablePrimary: true, setName: 'gpos' },
        ]);
        await awaitDatabaseReady(connection, fastClock());
        expect(command).toHaveBeenCalledTimes(4);
        for (const init of inits) expect(init).toHaveBeenCalledTimes(1);
    });

    it('gives up at the deadline without building indexes', async () => {
        const { connection, command, inits } = fakeConnection([]);
        command.mockResolvedValue({ isWritablePrimary: false });
        await expect(
            awaitDatabaseReady(connection, {
                ...fastClock(),
                timeoutMs: 1000,
                intervalMs: 300,
            }),
        ).rejects.toBeInstanceOf(DatabaseNotReadyError);
        expect(inits[0]).not.toHaveBeenCalled();
    });

    it('treats a missing db handle as not ready', async () => {
        const connection = {
            db: undefined,
            models: {},
        } as unknown as Connection;
        await expect(
            awaitDatabaseReady(connection, { ...fastClock(), timeoutMs: 10 }),
        ).rejects.toThrow(DatabaseNotReadyError);
    });

    it('fails the startup when an index cannot be built', async () => {
        const { connection, inits } = fakeConnection([
            { isWritablePrimary: true, setName: 'gpos' },
        ]);
        inits[1].mockRejectedValue(new Error('index conflict'));
        await expect(
            awaitDatabaseReady(connection, fastClock()),
        ).rejects.toThrow('index conflict');
    });
});

describe('connectionRetryOptions', () => {
    it('keeps the default for cloud environments', () => {
        expect(connectionRetryOptions(false)).toEqual({});
    });

    it('retries the initial connection for the readiness window on single-pc', () => {
        expect(connectionRetryOptions(true)).toEqual({
            retryAttempts: 40,
            retryDelay: 3000,
        });
    });
});
