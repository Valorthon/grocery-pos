// LAN terminal package and join plan (#397, ARCHITECTURE.md "LAN terminals
// (#402)"). On the main PC, "Make terminal package" runs (elevated):
//
//   node terminal.mjs package --data-root <dir> --to <folder>
//
// It writes GroceryPOS-terminal-<ip>\ with the public Caddy root
// (root.crt, never its key), terminal.json (server URL, the root's SHA-256
// and thumbprint), JoinTerminal.ps1 and README.txt. A Windows terminal has
// no Node: JoinTerminal.ps1 carries out `joinPlan` below, which is the
// tested specification of what it does.
//
// Exit codes: 0 done, 1 failed, 2 usage, 3 refused (nothing written).
import { X509Certificate, createHash } from 'node:crypto';
import { cp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PORTS, layout, lanOrigin, parseLanIp } from '../runtime/layout.mjs';
import { PRODUCT, caddyRootCertificate } from './plan.mjs';

export const TERMINAL_SCHEMA = 1;
export const TERMINAL_MODES = Object.freeze(['join', 'rejoin', 'leave']);
export const PACKAGE_FILES = Object.freeze({
    root: 'root.crt',
    info: 'terminal.json',
    script: 'JoinTerminal.ps1',
    readme: 'README.txt',
});
/** Where a joined terminal records the root it trusted (for rejoin/leave). */
export const TERMINAL_STATE_DIR = 'Valorthon\\GroceryPOS-Terminal';
export const TERMINAL_SHORTCUT_NAME = `${PRODUCT}.lnk`;
const EXIT = { OK: 0, FAILED: 1, USAGE: 2, REFUSED: 3 };

export class TerminalRefusedError extends Error {
    constructor(message) {
        super(message);
        this.name = 'TerminalRefusedError';
    }
}

function sha256(bytes) {
    return createHash('sha256').update(bytes).digest('hex');
}

/**
 * The package's terminal.json for the main PC's LAN IP and its Caddy root
 * (PEM bytes). The root must be a CA certificate; the thumbprint is its
 * SHA-1, which `certutil -delstore Root` takes.
 */
export function terminalInfo(lanIp, rootBytes) {
    const ip = parseLanIp(lanIp);
    if (!ip) {
        throw new TerminalRefusedError(
            'LAN terminals are off on this PC. Set a LAN IP first (Install.ps1 -Mode repair -LanIp <IP>).',
        );
    }
    let cert;
    try {
        cert = new X509Certificate(rootBytes);
    } catch {
        throw new TerminalRefusedError(
            'The Caddy root certificate could not be read. Run "Check Grocery POS".',
        );
    }
    if (!cert.ca) {
        throw new TerminalRefusedError(
            'The Caddy root file is not a CA certificate. Run "Check Grocery POS".',
        );
    }
    return {
        schema: TERMINAL_SCHEMA,
        product: PRODUCT,
        lanIp: ip,
        port: PORTS.proxy,
        serverUrl: lanOrigin(ip),
        rootSha256: sha256(rootBytes),
        rootThumbprint: cert.fingerprint.replace(/:/g, '').toUpperCase(),
        rootNotAfter: new Date(cert.validTo).toISOString(),
    };
}

/** Refuses a terminal.json that is not one this tool writes. */
export function checkInfo(info) {
    const ok =
        info &&
        info.schema === TERMINAL_SCHEMA &&
        typeof info.lanIp === 'string' &&
        info.port === PORTS.proxy &&
        info.serverUrl === lanOrigin(info.lanIp) &&
        /^[0-9a-f]{64}$/.test(info.rootSha256 ?? '') &&
        /^[0-9A-F]{40}$/.test(info.rootThumbprint ?? '');
    if (!ok) throw new TerminalRefusedError('terminal.json is not valid.');
    let ip = null;
    try {
        ip = parseLanIp(info.lanIp);
    } catch {
        // Reported below like any other invalid file.
    }
    if (!ip) throw new TerminalRefusedError('terminal.json is not valid.');
    return info;
}

/**
 * What JoinTerminal.ps1 does, in order. `actualRootSha256` is the hash of
 * the package's root.crt as found on the terminal and `actualRoot` what
 * loading it as a certificate shows (`{ thumbprint, ca }`); both must match
 * terminal.json before anything changes, and the recorded thumbprint is
 * the certificate's own. `recorded` is the
 * terminal's own record of a previous join (`{ thumbprint, serverUrl }`)
 * or null. Refusals change nothing.
 *
 * - join: trusts the root, points Windows time at the main PC, creates the
 *   "Grocery POS" Chrome shortcut, records the thumbprint, then checks TLS
 *   with a plain GET of the site root (never /v1/health*, refused on the
 *   LAN site). Joining again with the same root repeats it harmlessly; a
 *   different root needs rejoin.
 * - rejoin: as join, after deleting the previously recorded root by its
 *   thumbprint (never by name: every Caddy root has a similar CN).
 * - leave: deletes only the recorded root and the shortcut, and forgets
 *   the record. Windows time keeps its setting.
 */
export function joinPlan({
    mode,
    info,
    actualRootSha256,
    actualRoot,
    recorded = null,
}) {
    if (!TERMINAL_MODES.includes(mode)) {
        throw new Error(`The mode is one of: ${TERMINAL_MODES.join(', ')}.`);
    }
    if (mode === 'leave') {
        if (!recorded?.thumbprint) {
            throw new TerminalRefusedError(
                'This terminal is not joined to a Grocery POS main PC.',
            );
        }
        return [
            { kind: 'untrust', thumbprint: recorded.thumbprint },
            { kind: 'remove-shortcut' },
            { kind: 'forget' },
        ];
    }
    checkInfo(info);
    if (String(actualRootSha256 ?? '').toLowerCase() !== info.rootSha256) {
        throw new TerminalRefusedError(
            'root.crt does not match this package (SHA-256 differs). Make a new terminal package on the main PC.',
        );
    }
    const thumbprint = String(actualRoot?.thumbprint ?? '').toUpperCase();
    if (thumbprint !== info.rootThumbprint || actualRoot?.ca !== true) {
        throw new TerminalRefusedError(
            'root.crt is not the CA certificate this package names (thumbprint differs). Make a new terminal package on the main PC.',
        );
    }
    const replacing =
        recorded?.thumbprint && recorded.thumbprint !== thumbprint;
    if (mode === 'join' && replacing) {
        throw new TerminalRefusedError(
            'This terminal already trusts another Grocery POS root. Use rejoin to replace it.',
        );
    }
    return [
        ...(replacing
            ? [{ kind: 'untrust', thumbprint: recorded.thumbprint }]
            : []),
        { kind: 'trust', file: PACKAGE_FILES.root },
        {
            kind: 'record',
            thumbprint,
            serverUrl: info.serverUrl,
        },
        ...timeSteps(info.lanIp),
        { kind: 'shortcut', url: `${info.serverUrl}/` },
        { kind: 'verify-tls', url: `${info.serverUrl}/` },
    ];
}

/**
 * The terminal takes its time from the main PC (owner decision
 * 2026-11-20; the main PC serves NTP since #398). w32time is trigger-start
 * on workgroup PCs, so it is set to start automatically and its triggers
 * (which stop it again) are removed. The resync may fail while the main PC
 * is off; that is a warning, not a failure.
 */
export function timeSteps(lanIp) {
    return [
        {
            kind: 'exec',
            file: 'sc.exe',
            args: ['config', 'w32time', 'start=', 'auto'],
        },
        {
            kind: 'exec',
            file: 'sc.exe',
            args: ['triggerinfo', 'w32time', 'delete'],
            warnOnly: true,
        },
        { kind: 'start-service', name: 'w32time' },
        {
            kind: 'exec',
            file: 'w32tm.exe',
            args: [
                '/config',
                `/manualpeerlist:${lanIp},0x8`,
                '/syncfromflags:manual',
                '/update',
            ],
        },
        {
            kind: 'exec',
            file: 'w32tm.exe',
            args: ['/resync', '/force'],
            warnOnly: true,
        },
    ];
}

export function readmeText(info) {
    return [
        `${PRODUCT}: join a Windows terminal`,
        '',
        `Main PC: ${info.serverUrl}`,
        `Root certificate thumbprint: ${info.rootThumbprint}`,
        `Root certificate SHA-256: ${info.rootSha256}`,
        '',
        'On the terminal (Windows with Google Chrome, on the same shop network):',
        `1. Copy this folder (GroceryPOS-terminal-${info.lanIp}) to the terminal, for example to C:\\GroceryPOS-terminal.`,
        '2. Right-click Start, open "Terminal (Admin)" or "Windows PowerShell (Admin)".',
        '3. Go to the folder, then run the script:',
        '   cd C:\\GroceryPOS-terminal',
        '   powershell -ExecutionPolicy Bypass -File .\\JoinTerminal.ps1 -Mode join',
        '4. The script shows the certificate thumbprint before trusting it.',
        '   Compare it with the thumbprint the main PC showed (and above).',
        `5. Open "${PRODUCT}" on the desktop.`,
        '',
        'Time: the script sets this terminal to take its time from the main PC.',
        'Windows then checks it by itself (about every 17 minutes to 9',
        'hours). A clock more than 15 hours off (MaxPosPhaseCorrection and',
        'MaxNegPhaseCorrection, 54000 s) is not corrected: set the date',
        'and time by hand first, then run the script again. If the main PC is',
        'off, the script warns that the clock could not sync yet.',
        '',
        'After the main PC was replaced or its certificate changed, make a new',
        'package and run it with -Mode rejoin. To stop using this terminal, run',
        'it with -Mode leave.',
        '',
        'root.crt is public (no key). Keep the package anyway: it names the',
        'certificate this terminal will trust.',
        '',
    ].join('\r\n');
}

/** Writes the package folder; returns its path. Replaces an older copy. */
export async function writePackage({ dataRoot, to, lanIp, scriptDir }) {
    const rootBytes = await readFile(
        caddyRootCertificate(layout(dataRoot)),
    ).catch(() => {
        throw new TerminalRefusedError(
            'The Caddy root certificate is missing. Run "Check Grocery POS".',
        );
    });
    const info = terminalInfo(lanIp, rootBytes);
    const dir = join(resolve(to), `GroceryPOS-terminal-${info.lanIp}`);
    const partial = `${dir}.partial`;
    await rm(partial, { recursive: true, force: true });
    await mkdir(partial, { recursive: true });
    await writeFile(join(partial, PACKAGE_FILES.root), rootBytes);
    await writeFile(
        join(partial, PACKAGE_FILES.info),
        JSON.stringify(info, null, 2) + '\n',
    );
    await cp(
        join(scriptDir, PACKAGE_FILES.script),
        join(partial, PACKAGE_FILES.script),
    );
    await writeFile(join(partial, PACKAGE_FILES.readme), readmeText(info));
    await rm(dir, { recursive: true, force: true });
    await rename(partial, dir);
    return { dir, info };
}

/** The LAN IP the installer recorded (state\installer.json, else
 *  config\runtime.json; #396), or null. install.mjs uses it too. */
export async function readStoredLanIp(paths) {
    const read = async (file) =>
        JSON.parse(await readFile(file, 'utf8').catch(() => 'null'));
    const state = await read(join(paths.dirs.state, 'installer.json'));
    if (state && Object.hasOwn(state, 'lanIp')) return state.lanIp ?? null;
    return (await read(paths.runtimeManifest))?.lanIp ?? null;
}

export function parseArgs(argv) {
    const [command, ...args] = argv;
    if (command !== 'package') throw new Error('The command is: package.');
    const out = {};
    for (let i = 0; i < args.length; i += 2) {
        const name = { '--data-root': 'dataRoot', '--to': 'to' }[args[i]];
        if (!name || out[name] !== undefined || !args[i + 1]) {
            throw new Error(`Unknown or repeated option ${args[i]}.`);
        }
        out[name] = args[i + 1];
    }
    if (!out.dataRoot || !out.to) {
        throw new Error('--data-root and --to are required.');
    }
    return out;
}

async function main(argv) {
    let options;
    try {
        options = parseArgs(argv);
    } catch (error) {
        console.error(`Usage: ${error.message}`);
        return EXIT.USAGE;
    }
    try {
        const { dir, info } = await writePackage({
            ...options,
            lanIp: await readStoredLanIp(layout(options.dataRoot)),
            scriptDir: dirname(fileURLToPath(import.meta.url)),
        });
        console.log(`Done: ${dir}`);
        console.log(`Root thumbprint: ${info.rootThumbprint}`);
        console.log(`Root SHA-256: ${info.rootSha256}`);
        return EXIT.OK;
    } catch (error) {
        if (error instanceof TerminalRefusedError) {
            console.error(`Refused: ${error.message}`);
            return EXIT.REFUSED;
        }
        console.error(`Failed: ${error.message}`);
        return EXIT.FAILED;
    }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
    process.exitCode = await main(process.argv.slice(2));
}
