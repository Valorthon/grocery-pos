import {
    canonicalClientIp,
    isLoopbackHost,
    listenHost,
    trustProxySetting,
} from './http-topology';

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

    it('trusts only the loopback proxy in single-pc (#395)', () => {
        expect(trustProxySetting('single-pc')).toBe('loopback');
    });

    it('trusts nothing in dev and test', () => {
        expect(trustProxySetting('dev')).toBeUndefined();
        expect(trustProxySetting('test')).toBeUndefined();
    });
});

describe('canonicalClientIp (#395)', () => {
    it.each([
        ['::1', '127.0.0.1'],
        ['::ffff:127.0.0.1', '127.0.0.1'],
        ['127.0.0.1', '127.0.0.1'],
        ['::ffff:192.168.1.20', '192.168.1.20'],
        ['::FFFF:10.0.0.2', '10.0.0.2'],
        ['192.168.1.20', '192.168.1.20'],
        ['fe80::1', 'fe80::1'],
    ])('%s -> %s', (ip, expected) => {
        expect(canonicalClientIp(ip)).toBe(expected);
    });
});
