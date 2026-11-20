import { clientIp, userTracker } from './rate-limit';

describe('clientIp (#395)', () => {
    it('counts the main PC as one client over IPv4 or IPv6 loopback', () => {
        expect(clientIp({ ip: '::1' })).toBe('127.0.0.1');
        expect(clientIp({ ip: '::ffff:127.0.0.1' })).toBe('127.0.0.1');
        expect(clientIp({ ip: '127.0.0.1' })).toBe('127.0.0.1');
    });

    it('keeps each LAN terminal apart', () => {
        expect(clientIp({ ip: '192.168.1.20' })).toBe('192.168.1.20');
        expect(clientIp({ ip: '192.168.1.21' })).not.toBe(
            clientIp({ ip: '192.168.1.20' }),
        );
    });

    it('is "unknown" without an address', () => {
        expect(clientIp({})).toBe('unknown');
    });

    it('tracks a signed-in user by id, else by the canonical IP', () => {
        expect(userTracker({ ip: '::1', user: { userId: 'u1' } })).toBe(
            'user:u1',
        );
        expect(userTracker({ ip: '::1' })).toBe('127.0.0.1');
    });
});
