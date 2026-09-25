import {
    assertSeedAllowed,
    describeDatabase,
    FORCE_DESTROY_FLAG,
} from './seed-guard';

describe('assertSeedAllowed', () => {
    it.each(['prod', 'stage', ' PROD '])(
        'refuses NODE_ENV=%s without the flag',
        (env) => {
            expect(() => assertSeedAllowed(env, [])).toThrow(
                FORCE_DESTROY_FLAG,
            );
            expect(() => assertSeedAllowed(env, ['--force'])).toThrow();
        },
    );

    it.each(['prod', 'stage'])('allows NODE_ENV=%s with the flag', (env) => {
        expect(() =>
            assertSeedAllowed(env, ['--verbose', FORCE_DESTROY_FLAG]),
        ).not.toThrow();
    });

    it.each(['dev', 'test', undefined])(
        'allows NODE_ENV=%s without the flag',
        (env) => {
            expect(() => assertSeedAllowed(env, [])).not.toThrow();
        },
    );
});

describe('describeDatabase', () => {
    it.each([
        ['mongodb://127.0.0.1:27017/grocery', '127.0.0.1:27017/grocery'],
        [
            'mongodb://user:p%40ss@db.example.com:27017/pos?authSource=admin',
            'db.example.com:27017/pos',
        ],
        [
            'mongodb+srv://user:secret@cluster0.abc.mongodb.net/shop?retryWrites=true',
            'cluster0.abc.mongodb.net/shop',
        ],
        ['mongodb://a:1,b:2,c:3/grocery?replicaSet=rs0', 'a:1,b:2,c:3/grocery'],
        ['mongodb://localhost:27017', 'localhost:27017/test'],
        ['mongodb://localhost:27017/?replicaSet=rs0', 'localhost:27017/test'],
    ])('%s -> %s, never the credentials', (url, expected) => {
        const described = describeDatabase(url);

        expect(described).toBe(expected);
        expect(described).not.toMatch(/secret|p%40ss|user/);
    });
});
