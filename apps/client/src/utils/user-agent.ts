/**
 * A short device summary from a user-agent string (#306): browser and
 * major version on OS, e.g. "Chrome 157 on Linux". No dependency; an
 * unrecognised string is "Unknown device".
 */
export function deviceSummary(userAgent: string): string {
    const browser = browserOf(userAgent);
    const os = osOf(userAgent);
    if (!browser && !os) return 'Unknown device';
    if (!browser) return `Unknown browser on ${os}`;
    return os ? `${browser} on ${os}` : browser;
}

const BROWSERS: [name: string, pattern: RegExp][] = [
    ['Edge', /\bEdg(?:e|A|iOS)?\/(\d+)/],
    ['Firefox', /\b(?:Firefox|FxiOS)\/(\d+)/],
    ['Chrome', /\b(?:Chrome|CriOS)\/(\d+)/],
    ['Safari', /\bVersion\/(\d+)[^ ]* (?:Mobile\/\S+ )?Safari\//],
];

function browserOf(userAgent: string): string | null {
    for (const [name, pattern] of BROWSERS) {
        const match = pattern.exec(userAgent);
        if (match) return `${name} ${match[1]}`;
    }
    return null;
}

const SYSTEMS: [name: string, pattern: RegExp][] = [
    ['Windows', /\bWindows\b/],
    ['Android', /\bAndroid\b/],
    ['iOS', /\b(?:iPhone|iPad|iPod)\b/],
    ['ChromeOS', /\bCrOS\b/],
    ['macOS', /\bMac OS X\b|\bMacintosh\b/],
    ['Linux', /\bLinux\b/],
];

function osOf(userAgent: string): string | null {
    return SYSTEMS.find(([, pattern]) => pattern.test(userAgent))?.[0] ?? null;
}
