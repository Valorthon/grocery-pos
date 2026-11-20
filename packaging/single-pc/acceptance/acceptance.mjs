#!/usr/bin/env node
/**
 * Operator-run acceptance harness for the installed single-PC package (#366).
 *
 * Runs the read-only, scriptable checks of RUNBOOK.md on the Windows 11 x64
 * target and writes one redacted evidence JSON. It never installs, stops,
 * starts, restores or changes anything; the destructive and interactive
 * scenarios (reboot, power cut, LAN device, Chrome, upgrade) stay manual in
 * the runbook, and the evidence file lists them as `manual`, never as passed.
 *
 * Every Windows command goes through an injectable context (`ctx.run`), so
 * the decision logic is tested on Linux. **Not yet executed on Windows.**
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
    LAN_SERVICE,
    PORTS,
    SERVICES,
    isPrivateIpv4,
    layout,
} from '../runtime/layout.mjs';
import {
    HANDOVER_FILE,
    TASKS,
    locations,
    allShortcuts,
    serviceAccount,
} from '../installer/plan.mjs';

export const EXIT = { OK: 0, ATTENTION: 1, USAGE: 2, REFUSED: 3 };
export const EVIDENCE_SCHEMA = 1;
/** Owner decision (#357): a 30-minute maintenance window target. */
export const UPGRADE_WINDOW_MS = 30 * 60 * 1000;
export const STATUSES = Object.freeze(['pass', 'fail', 'error', 'manual']);

/** Runbook scenarios that only a person can perform (RUNBOOK.md). */
export const MANUAL = Object.freeze([
    {
        id: 'A3',
        closes: ['#357'],
        what: 'proof/run.mjs compiled-runtime proof',
    },
    { id: 'A6', closes: ['#357'], what: '4 GB counters during A3' },
    {
        id: 'B1',
        closes: ['#366', '#362', '#361'],
        what: 'clean install + first ADMIN login and forced change',
    },
    {
        id: 'B2',
        closes: ['#366', '#360', '#362'],
        what: 'reboot, services up before Windows logon',
    },
    {
        id: 'B3',
        closes: ['#366', '#359'],
        what: 'internet disconnected, local API reachable, full operations',
    },
    {
        id: 'B4',
        closes: ['#366', '#359'],
        what: 'real API outage, offline cash, lost-response retry',
    },
    {
        id: 'B5',
        closes: ['#366'],
        what: 'authenticated transactions on the installed DB',
    },
    {
        id: 'B6',
        closes: ['#366', '#358', '#393', '#394', '#395', '#396'],
        what: 'LAN refusal: 1443 only from a joined terminal on the subnet; 13000/27018, other subnets, Public profile and /v1/health* refused',
    },
    { id: 'B7', closes: ['#366', '#363'], what: 'replacement-PC restore' },
    {
        id: 'B8',
        closes: ['#366', '#364'],
        what: 'populated and interrupted upgrade',
    },
    {
        id: 'B9',
        closes: ['#366', '#364'],
        what: 'stale tab / service worker across upgrade',
    },
    {
        id: 'B10',
        closes: ['#366', '#364', '#363'],
        what: 'pending receipts preserved',
    },
    {
        id: 'B11',
        closes: ['#366', '#360', '#362'],
        what: 'crash and power-cut recovery',
    },
    {
        id: 'B12',
        closes: ['#366', '#362'],
        what: 'repair, uninstall, reinstall retention',
    },
    { id: 'B14', closes: ['#366', '#357'], what: 'workload on the 4 GB PC' },
    { id: 'B15', closes: ['#366'], what: 'documentation followed as written' },
    {
        id: 'B17',
        closes: ['#362'],
        what: 'Back up to USB drive, UAC accept/decline',
    },
    {
        id: 'C1',
        closes: ['#358'],
        what: 'browser auth flows at the installed origin',
    },
    {
        id: 'C5',
        closes: ['#365'],
        what: 'failure exercises (API/DB down, low disk, failed backup)',
    },
    {
        id: 'C6',
        closes: ['#365'],
        what: 'CheckHealth.ps1 elevation, save support file',
    },
    // #401: two-PC LAN terminal rows (Android rows come with #400).
    {
        id: 'D1',
        closes: ['#401', '#396'],
        what: 'LAN site service, firewall and shared root',
    },
    {
        id: 'D2',
        closes: ['#401', '#397'],
        what: 'join, rejoin and leave a Windows terminal',
    },
    {
        id: 'D3',
        closes: ['#401', '#395'],
        what: 'concurrent sales on two terminals',
    },
    {
        id: 'D4',
        closes: ['#401', '#359', '#37'],
        what: 'cable pull mid-shift, offline cash and sync',
    },
    {
        id: 'D5',
        closes: ['#401', '#364'],
        what: 'upgrade with a stale terminal tab (CLIENT_OUTDATED)',
    },
    {
        id: 'D6',
        closes: ['#401', '#363'],
        what: 'restore logs every terminal out',
    },
    {
        id: 'D7',
        closes: ['#401', '#363', '#396'],
        what: 'replacement PC, then rejoin',
    },
    {
        id: 'D8',
        closes: ['#401', '#396', '#397'],
        what: 'LAN IP change',
    },
    {
        id: 'D9',
        closes: ['#401', '#398'],
        what: 'terminal clock ±5 min and ±3 h',
    },
    {
        id: 'D10',
        closes: ['#401', '#398'],
        what: 'time server (NTP) rule and timeServer check',
    },
    {
        id: 'D11',
        closes: ['#401', '#398'],
        what: 'Caddy leaf renewal "not yet valid" watch',
    },
    {
        id: 'D12',
        closes: ['#401', '#399', '#396'],
        what: 'lanNetwork and lanProxy diagnostics',
    },
    {
        id: 'D13',
        closes: ['#401', '#399'],
        what: 'terminal label before a shift',
    },
]);

// ------------------------------------------------------------ redaction

const REDACTIONS = [
    [/mongodb(\+srv)?:\/\/[^\s"']+/gi, 'mongodb://[redacted]'],
    [
        /((?:password|secret|token|cookie|authorization)["']?\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;]+)/gi,
        '$1[redacted]',
    ],
    [/\beyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{10,}/g, '[jwt]'],
    // Long base64/base64url runs with mixed case and digits look like keys
    // or secrets; hex digests and commit ids stay (evidence), and so do
    // paths and words (no digit or no mixed case).
    [
        /[A-Za-z0-9+_-]{32,}={0,2}/g,
        (m) =>
            /^([0-9a-f]{40}|[0-9a-f]{64})$/i.test(m) ||
            !(/[0-9]/.test(m) && /[a-z]/.test(m) && /[A-Z]/.test(m))
                ? m
                : '[redacted]',
    ],
];

/** Object keys whose values are never kept, whatever they look like. */
const SECRET_KEY = /^[a-z_]*(password|secret|token|cookie)[a-z_]*$/i;

/** Removes connection strings, credentials and key-like text. SHA-256
 *  digests and git commit ids (evidence) are kept. */
export function redact(text, limit = 4000) {
    let out = String(text ?? '');
    for (const [pattern, replacement] of REDACTIONS)
        out = out.replace(pattern, replacement);
    return out.length > limit ? `${out.slice(0, limit)}…` : out;
}

export function redactDeep(value) {
    if (typeof value === 'string') return redact(value);
    if (Array.isArray(value)) return value.map(redactDeep);
    if (value && typeof value === 'object') {
        return Object.fromEntries(
            Object.entries(value).map(([k, v]) => [
                k,
                SECRET_KEY.test(k) ? '[redacted]' : redactDeep(v),
            ]),
        );
    }
    return value;
}

// ------------------------------------------------------------ parsing

const LOOPBACK = new Set(['127.0.0.1', '::1']);

/** Parses `ConvertTo-Json` output that may be one object or an array. */
export function jsonList(text) {
    const trimmed = String(text ?? '').trim();
    if (!trimmed) return [];
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed : [parsed];
}

/**
 * #358/#360/#396: every listener on our ports is loopback, and each port
 * listens. The one exception is Caddy on the configured LAN IP (port 1443
 * only), and only while `GroceryPOS-ProxyLan` may own it: like diagnostics'
 * `ports` check, any state but Stopped/absent/unknown (e.g. StartPending or
 * an SCM recovery restart) may hold the LAN listener. Unlike diagnostics,
 * an unreadable service state fails closed (the LAN listener is exposed).
 */
export function evaluateListeners(rows, { lanIp = null, lanService } = {}) {
    const ports = Object.values(PORTS);
    const ours = rows.filter((r) => ports.includes(Number(r.LocalPort)));
    const lanOwned =
        lanIp !== null &&
        lanService != null &&
        !['stopped', 'absent'].includes(String(lanService).toLowerCase());
    const allowed = (r) =>
        LOOPBACK.has(String(r.LocalAddress)) ||
        (lanOwned &&
            Number(r.LocalPort) === PORTS.proxy &&
            String(r.LocalAddress)
                .toLowerCase()
                .replace(/^::ffff:/, '') === lanIp);
    const exposed = ours.filter((r) => !allowed(r));
    const missing = ports.filter(
        (p) =>
            !ours.some(
                (r) =>
                    Number(r.LocalPort) === p &&
                    LOOPBACK.has(String(r.LocalAddress)),
            ),
    );
    return {
        status: exposed.length || missing.length ? 'fail' : 'pass',
        observed: ours.map((r) => `${r.LocalAddress}:${r.LocalPort}`),
        exposed: exposed.map((r) => `${r.LocalAddress}:${r.LocalPort}`),
        missing,
        lanIp,
        lanService: lanIp === null ? null : (lanService ?? null),
    };
}

/** #360/#362: each service runs, starts automatically, under its own
 *  virtual account, in dependency order MongoDB → API → Proxy. */
export function evaluateServices(rows) {
    const order = [SERVICES.mongo, SERVICES.api, SERVICES.proxy];
    const problems = [];
    for (const [i, name] of order.entries()) {
        const row = rows.find((r) => r.Name === name);
        if (!row) {
            problems.push(`${name}: not registered`);
            continue;
        }
        if (row.State !== 'Running') problems.push(`${name}: ${row.State}`);
        if (row.StartMode !== 'Auto')
            problems.push(`${name}: start mode ${row.StartMode}`);
        if (
            String(row.StartName).toLowerCase() !==
            serviceAccount(name).toLowerCase()
        ) {
            problems.push(`${name}: runs as ${row.StartName}`);
        }
        const deps = [].concat(row.DependsOn ?? []).map(String);
        if (i > 0 && !deps.includes(order[i - 1]))
            problems.push(`${name}: does not depend on ${order[i - 1]}`);
    }
    return { status: problems.length ? 'fail' : 'pass', problems };
}

/** B16: the handover folder and its file have no inherited entries and
 *  grant only SYSTEM and Administrators. Other paths are recorded for the
 *  operator to compare with the runtime README table. */
export function evaluateHandoverAcl(facts) {
    const entries = [].concat(facts?.Rules ?? []);
    const problems = [];
    if (!entries.length) problems.push('no ACL entries read');
    for (const entry of entries) {
        if (entry.Inherited) problems.push(`inherited: ${entry.Sid}`);
        if (!['S-1-5-18', 'S-1-5-32-544'].includes(entry.Sid))
            problems.push(`unexpected: ${entry.Sid}`);
    }
    return { status: problems.length ? 'fail' : 'pass', problems };
}

function handoverAclQuery(path) {
    const literal = path.replace(/'/g, "''");
    return ps(
        `$a = Get-Acl -LiteralPath '${literal}'; $s = [System.Security.Principal.SecurityIdentifier]; ` +
            `[pscustomobject]@{ Rules = @($a.GetAccessRules($true, $true, $s) | ForEach-Object { [pscustomobject]@{ Sid = $_.IdentityReference.Value; Inherited = $_.IsInherited } }) } | ConvertTo-Json -Depth 4 -Compress`,
    );
}

/** #364: the upgrade journal's total time against the 30-minute target. */
export function evaluateUpgradeJournal(journal) {
    if (!journal)
        return {
            status: 'manual',
            note: 'No state\\upgrade.json yet: run B8 first.',
        };
    const total = journal.timings?.total;
    if (!Number.isFinite(total))
        return {
            status: 'fail',
            note: `upgrade not finished (state ${journal.state ?? 'unknown'})`,
        };
    return {
        status: total <= UPGRADE_WINDOW_MS ? 'pass' : 'fail',
        totalMinutes: Math.round((total / 60000) * 10) / 10,
        timings: journal.timings,
        state: journal.state,
    };
}

/** #365: diagnose.mjs check --json. Overall ok passes; anything else is
 *  recorded as found (a failure exercise may expect it). */
export function evaluateDiagnostics(report) {
    const failing = (report.checks ?? []).filter(
        (c) => c.status === 'fail' || c.status === 'warn',
    );
    return {
        status: report.overall === 'ok' ? 'pass' : 'fail',
        overall: report.overall,
        failing: failing.map((c) => `${c.id}: ${c.status}`),
        notObserved: report.notObserved ?? [],
    };
}

// ------------------------------------------------------------ context

function ps(command) {
    return [
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', command],
    ];
}

export function realContext() {
    return {
        platform: process.platform,
        env: process.env,
        now: () => new Date(),
        execPath: process.execPath,
        run(cmd, args, { timeout = 120000 } = {}) {
            const r = spawnSync(cmd, args, {
                encoding: 'utf8',
                timeout,
                windowsHide: true,
            });
            return {
                code: r.status ?? -1,
                stdout: r.stdout ?? '',
                stderr: r.stderr ?? String(r.error ?? ''),
            };
        },
        readFile: (p) => readFile(p),
        writeNew: (p, text) => writeFile(p, text, { flag: 'wx' }),
    };
}

// ------------------------------------------------------------ checks

async function check(id, runbook, closes, fn) {
    try {
        const result = await fn();
        return { id, runbook, closes, ...result };
    } catch (error) {
        return {
            id,
            runbook,
            closes,
            status: 'error',
            note: redact(error.message, 400),
        };
    }
}

/** The runtime manifest's LAN IP (#396), only if a private IPv4. */
async function configuredLanIp(ctx, paths) {
    try {
        const { lanIp } = JSON.parse(
            String(await ctx.readFile(paths.runtimeManifest)),
        );
        return typeof lanIp === 'string' && isPrivateIpv4(lanIp) ? lanIp : null;
    } catch (error) {
        if (error?.code === 'ENOENT') return null;
        throw error;
    }
}

function runJson(ctx, [cmd, args]) {
    const r = ctx.run(cmd, args);
    if (r.code !== 0) throw new Error(`exit ${r.code}: ${r.stderr}`);
    return jsonList(r.stdout);
}

export async function runChecks(ctx, options) {
    const loc = locations(ctx.env);
    const dataRoot = options.dataRoot ?? loc.dataRoot;
    const paths = layout(dataRoot);
    const node = ctx.execPath;
    const results = [];

    results.push(
        await check('platform', ['0', 'A1'], ['#357'], () => {
            const [os] = runJson(
                ctx,
                ps(
                    'Get-CimInstance Win32_OperatingSystem | Select-Object Caption,Version,BuildNumber,OSArchitecture,TotalVisibleMemorySize | ConvertTo-Json',
                ),
            );
            const cpus = runJson(
                ctx,
                ps(
                    'Get-CimInstance Win32_Processor | Select-Object Name,Manufacturer,NumberOfCores,NumberOfLogicalProcessors,Architecture | ConvertTo-Json',
                ),
            );
            const disks = runJson(
                ctx,
                ps(
                    'Get-PhysicalDisk | Select-Object FriendlyName,MediaType,BusType,Size | ConvertTo-Json',
                ),
            );
            const problems = [];
            if (
                !/Windows 11/i.test(os?.Caption ?? '') ||
                /Server/i.test(os?.Caption ?? '')
            )
                problems.push(
                    `not a Windows 11 client edition: ${os?.Caption}`,
                );
            if (Number(os?.BuildNumber) < 22000)
                problems.push(`build ${os?.BuildNumber}`);
            if (!/64/.test(String(os?.OSArchitecture)))
                problems.push(`architecture ${os?.OSArchitecture}`);
            // Win32_Processor.Architecture 9 = x64; 12 = ARM64.
            for (const c of cpus)
                if (Number(c.Architecture) !== 9)
                    problems.push(`CPU architecture ${c.Architecture}`);
            for (const c of cpus)
                if (!/intel|amd/i.test(c.Manufacturer ?? ''))
                    problems.push(`CPU vendor ${c.Manufacturer}`);
            return {
                status: problems.length ? 'fail' : 'pass',
                problems,
                os,
                cpus,
                disks,
                note: "Also check the CPU against Microsoft's supported list and the build against release health (A1 step 4, manual).",
            };
        }),
    );

    results.push(
        await check('bundle', ['A2', 'R1'], ['#366'], async () => {
            if (!options.bundle)
                return {
                    status: 'manual',
                    note: 'Pass --bundle and --manifest-sha256 to verify the delivered bundle.',
                };
            const { readBundle } = await import('../installer/install.mjs');
            const manifestPath = join(options.bundle, 'bundle-manifest.json');
            const bytes = await ctx.readFile(manifestPath);
            const observed = createHash('sha256').update(bytes).digest('hex');
            const result = await readBundle(options.bundle, {
                manifest: manifestPath,
                manifestSha256: options.manifestSha256,
            });
            return {
                status: 'pass',
                manifestSha256: observed,
                version: result.manifest.version,
                commit: result.manifest.commit,
                components: result.manifest.components,
                files: Object.keys(result.manifest.files).length,
            };
        }),
    );

    results.push(
        await check('services', ['B1', 'B2', 'C2'], ['#360', '#362'], () => {
            const names = Object.values(SERVICES)
                .map((n) => `'${n}'`)
                .join(',');
            const rows = runJson(
                ctx,
                ps(
                    `Get-CimInstance Win32_Service | Where-Object { @(${names}) -contains $_.Name } | ForEach-Object { [pscustomobject]@{ Name=$_.Name; State=$_.State; StartMode=$_.StartMode; StartName=$_.StartName; DependsOn=@((Get-Service $_.Name).ServicesDependedOn.Name) } } | ConvertTo-Json -Depth 3`,
                ),
            );
            return { ...evaluateServices(rows), rows };
        }),
    );

    results.push(
        await check(
            'listeners',
            ['B6', 'C3'],
            ['#358', '#360', '#396'],
            async () => {
                const ports = Object.values(PORTS).join(',');
                const rows = runJson(
                    ctx,
                    ps(
                        `Get-NetTCPConnection -State Listen -LocalPort ${ports} -ErrorAction SilentlyContinue | Select-Object LocalAddress,LocalPort,OwningProcess | ConvertTo-Json`,
                    ),
                );
                const lanIp = await configuredLanIp(ctx, paths);
                let lanService = null;
                if (lanIp) {
                    const r = ctx.run(
                        ...ps(
                            `$s = Get-Service -Name '${LAN_SERVICE}' -ErrorAction SilentlyContinue; if ($s) { $s.Status.ToString() } else { 'absent' }`,
                        ),
                    );
                    if (r.code === 0 && r.stdout.trim())
                        lanService = r.stdout.trim();
                }
                return {
                    ...evaluateListeners(rows, { lanIp, lanService }),
                    note: 'Local proof only; B6 still needs a joined LAN terminal and a device on another subnet.',
                };
            },
        ),
    );

    results.push(
        await check('trusted-origin', ['B13'], ['#358', '#362'], () => {
            // Invoke-WebRequest uses the Windows trust store, as Chrome does.
            const r = ctx.run(
                ...ps(
                    "[Net.ServicePointManager]::SecurityProtocol='Tls12'; (Invoke-WebRequest -UseBasicParsing -TimeoutSec 20 https://localhost:1443/v1/health/ready).StatusCode",
                ),
            );
            const ok = r.code === 0 && r.stdout.trim() === '200';
            return {
                status: ok ? 'pass' : 'fail',
                observed: redact(r.stdout.trim() || r.stderr, 400),
                note: 'Chrome without a warning is still checked by eye (B13).',
            };
        }),
    );

    results.push(
        await check('acl-handover', ['B16'], ['#361', '#362'], () => {
            const r = ctx.run(...handoverAclQuery(loc.handoverDir));
            if (r.code !== 0)
                return {
                    status: 'manual',
                    note: 'Handover folder absent (handover-done already run?); record that instead.',
                };
            const folder = evaluateHandoverAcl(JSON.parse(r.stdout));
            const file = join(loc.handoverDir, HANDOVER_FILE);
            const f = ctx.run(...handoverAclQuery(file));
            const problems = [...folder.problems];
            if (f.code === 0)
                problems.push(
                    ...evaluateHandoverAcl(JSON.parse(f.stdout)).problems.map(
                        (p) => `file ${p}`,
                    ),
                );
            return {
                status: problems.length ? 'fail' : 'pass',
                problems,
                passwordFileChecked: f.code === 0,
            };
        }),
    );

    results.push(
        await check('acl-data', ['B16', 'C2'], ['#360', '#362', '#363'], () => {
            const targets = [
                paths.root,
                paths.dirs.secrets,
                paths.apiEnv,
                ...Object.values(paths.secrets),
                paths.dirs.database,
                paths.dirs.tls,
                paths.dirs.logs,
                paths.dirs.backups,
            ];
            const out = {};
            for (const t of targets)
                out[t] = redact(ctx.run('icacls', [t]).stdout, 2000);
            return {
                status: 'manual',
                icacls: out,
                note: 'Compare with runtime/README.md "Permissions"; record PASS/FAIL in B16.',
            };
        }),
    );

    results.push(
        await check('tasks', ['C4'], ['#362', '#363', '#365'], () => {
            const problems = [];
            const found = {};
            for (const task of Object.values(TASKS)) {
                const r = ctx.run('schtasks', [
                    '/Query',
                    '/TN',
                    task,
                    '/V',
                    '/FO',
                    'LIST',
                ]);
                if (r.code !== 0) problems.push(`${task}: missing`);
                found[task] = redact(r.stdout, 1500);
            }
            return {
                status: problems.length ? 'fail' : 'pass',
                problems,
                found,
            };
        }),
    );

    results.push(
        await check('shortcuts', ['B1', 'C6'], ['#362', '#365'], () => {
            const list = allShortcuts(loc);
            const quoted = list
                .map((p) => `'${p.replace(/'/g, "''")}'`)
                .join(',');
            const r = ctx.run(
                ...ps(
                    `@(${quoted}) | ForEach-Object { [pscustomobject]@{ Path=$_; Exists=(Test-Path -LiteralPath $_) } } | ConvertTo-Json`,
                ),
            );
            const rows = jsonList(r.stdout);
            const missing = rows.filter((x) => !x.Exists).map((x) => x.Path);
            return {
                status:
                    missing.length || rows.length !== list.length
                        ? 'fail'
                        : 'pass',
                missing,
            };
        }),
    );

    results.push(
        await check('diagnostics', ['C5', 'B15'], ['#365'], () => {
            if (!options.release)
                return {
                    status: 'manual',
                    note: 'Pass --release to run diagnose.mjs check.',
                };
            const r = ctx.run(node, [
                join(options.release, 'tools', 'diagnostics', 'diagnose.mjs'),
                'check',
                '--data-root',
                dataRoot,
                '--release',
                options.release,
                '--json',
            ]);
            return evaluateDiagnostics(JSON.parse(r.stdout));
        }),
    );

    results.push(
        await check('backup-status', ['B7', 'C4'], ['#363'], () => {
            if (!options.release)
                return {
                    status: 'manual',
                    note: 'Pass --release to read backup status.',
                };
            const r = ctx.run(node, [
                join(options.release, 'tools', 'backup', 'backup.mjs'),
                'status',
                '--data-root',
                dataRoot,
            ]);
            const status = JSON.parse(r.stdout);
            const ok =
                r.code === 0 &&
                Boolean(status.lastVerifiedSuccess) &&
                !status.backupOverdue;
            return { status: ok ? 'pass' : 'fail', backupStatus: status };
        }),
    );

    results.push(
        await check('upgrade-window', ['B8', 'C7'], ['#364'], async () => {
            const text = await ctx
                .readFile(join(paths.dirs.state, 'upgrade.json'))
                .catch(() => undefined);
            return evaluateUpgradeJournal(
                text ? JSON.parse(String(text)) : undefined,
            );
        }),
    );

    return results;
}

export function evidence(ctx, options, results) {
    const counts = Object.fromEntries(
        STATUSES.map((s) => [s, results.filter((r) => r.status === s).length]),
    );
    return redactDeep({
        schema: EVIDENCE_SCHEMA,
        tool: 'packaging/single-pc/acceptance/acceptance.mjs',
        generatedAt: ctx.now().toISOString(),
        platform: ctx.platform,
        commit: options.commit ?? null,
        operatorNote:
            'Automated read-only checks only. A pass here is not package acceptance: every manual item must be run and recorded in RUNBOOK.md.',
        counts,
        results,
        manual: MANUAL,
    });
}

export function parseArgs(args) {
    const out = {};
    const flags = {
        '--out': 'out',
        '--data-root': 'dataRoot',
        '--release': 'release',
        '--bundle': 'bundle',
        '--manifest-sha256': 'manifestSha256',
        '--commit': 'commit',
    };
    for (let i = 0; i < args.length; i++) {
        const key = flags[args[i]];
        if (!key) throw new Error(`Unknown option ${args[i]}.`);
        const value = args[++i];
        if (value === undefined || value.startsWith('--'))
            throw new Error(`${args[i - 1]} needs a value.`);
        out[key] = value;
    }
    if (!out.out) throw new Error('--out <new evidence file> is required.');
    if (out.bundle && !/^[0-9a-f]{64}$/i.test(out.manifestSha256 ?? ''))
        throw new Error('--bundle needs --manifest-sha256 <64 hex>.');
    if (out.commit && !/^[0-9a-f]{40}$/.test(out.commit))
        throw new Error('--commit must be 40 hex characters.');
    for (const k of ['out', 'dataRoot', 'release', 'bundle'])
        if (out[k]) out[k] = resolve(out[k]);
    return out;
}

export async function main(
    argv,
    ctx = realContext(),
    print = (l) => process.stdout.write(`${l}\n`),
) {
    let options;
    try {
        options = parseArgs(argv);
    } catch (error) {
        print(`Usage: ${error.message}`);
        return EXIT.USAGE;
    }
    if (ctx.platform !== 'win32') {
        // Evidence must come from the target; never write a Linux file.
        print(
            'Refused: run this on the Windows 11 x64 target (nothing was written).',
        );
        return EXIT.REFUSED;
    }
    const results = await runChecks(ctx, options);
    const doc = evidence(ctx, options, results);
    try {
        await ctx.writeNew(options.out, JSON.stringify(doc, null, 2) + '\n');
    } catch (error) {
        print(
            `Refused: ${error.code === 'EEXIST' ? 'the evidence file exists; choose a new name' : 'cannot write the evidence file'}.`,
        );
        return EXIT.REFUSED;
    }
    for (const r of results)
        print(
            `${r.status.toUpperCase().padEnd(6)} ${r.id} (${r.runbook.join(', ')})`,
        );
    print(
        `${MANUAL.length} manual scenarios remain; see RUNBOOK.md. Evidence: ${options.out}`,
    );
    return doc.counts.fail || doc.counts.error ? EXIT.ATTENTION : EXIT.OK;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
    process.exit(await main(process.argv.slice(2)));
}
