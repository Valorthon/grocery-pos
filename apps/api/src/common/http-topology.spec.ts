import { isLoopbackHost, listenHost, trustProxySetting } from './http-topology';

describe('listenHost (#358)', () => {
    it('binds single-pc to IPv4 loopback by default', () => {
        expect(listenHost('single-pc', undefined)).toBe('127.0.0.1');
    });

    it.each(['prod', 'stage', 'dev', 'test'])(
        'keeps 0.0.0.0 for %s (cloud containers unchanged)',
        (env) => {
            expect(listenHost(env, undefined)).toBe('0.0.0.0');
        },
    );

    it('uses HOST when set', () => {
        expect(listenHost('single-pc', '::1')).toBe('::1');
        expect(listenHost('prod', '127.0.0.1')).toBe('127.0.0.1');
    });
});

describe('isLoopbackHost', () => {
    it.each([
        ['127.0.0.1', true],
        ['::1', true],
        ['0.0.0.0', false],
        ['::', false],
        ['localhost', false],
        ['10.0.0.2', false],
    ])('%s -> %s', (host, expected) => {
        expect(isLoopbackHost(host)).toBe(expected);
    });
});

describe('trustProxySetting', () => {
    it('trusts one hop in prod and stage (unchanged)', () => {
        expect(trustProxySetting('prod')).toBe(1);
        expect(trustProxySetting('stage')).toBe(1);
    });

    it('trusts no proxy in single-pc: req.ip is the socket peer', () => {
        expect(trustProxySetting('single-pc')).toBeUndefined();
    });

    it('trusts nothing in dev and test', () => {
        expect(trustProxySetting('dev')).toBeUndefined();
        expect(trustProxySetting('test')).toBeUndefined();
    });
});
