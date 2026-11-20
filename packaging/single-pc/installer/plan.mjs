// Single-PC installer plan (#362): pure functions that turn the runtime
// interface (../runtime/layout.mjs) into the Windows steps install.mjs runs:
// preflight decisions, service registration, service identities and ACLs,
// scheduled tasks, shortcut and uninstall. No I/O here, so portable tests pin
// every generated command and definition. See README.md.
import { join } from 'node:path';
import {
    ORIGIN,
    PORTS,
    SERVICES,
    releaseLayout,
    serviceDefinitions,
    winswXml,
} from '../runtime/layout.mjs';

export const PRODUCT = 'Grocery POS';
export const VENDOR_DIR = 'Valorthon';
export const PRODUCT_DIR = 'GroceryPOS';
/** Task Scheduler folder for this product's tasks. */
export const TASK_FOLDER = '\\GroceryPOS\\';
export const TASKS = Object.freeze({
    backup: `${TASK_FOLDER}Daily backup`,
    exportReminder: `${TASK_FOLDER}Weekly export reminder`,
    // Owner decision 2026-11-15 (#365): nightly, right after the backup.
    logRotation: `${TASK_FOLDER}Nightly log rotation`,
});
/** Minutes after the backup start that log rotation runs (#365). */
export const LOG_ROTATION_DELAY_MINUTES = 30;
export const SHORTCUT_NAME = `${PRODUCT}.lnk`;
/** Owner decision 2026-11-15: guided export to a USB drive. */
export const BACKUP_SHORTCUT_NAME = 'Back up to USB drive.lnk';
/** Owner decisions 2026-11-15 (#365): health check and recovery guide. */
export const CHECK_SHORTCUT_NAME = `Check ${PRODUCT}.lnk`;
export const HELP_SHORTCUT_NAME = `${PRODUCT} help.lnk`;
/** The owner's handover guide (owner decision on #366). */
export const OWNER_GUIDE_SHORTCUT_NAME = `${PRODUCT} owner guide.lnk`;
/** Releases kept by repair: the current one and the newest other one. */
export const KEEP_RELEASES = 2;
export const HANDOVER_FILE = 'initial-admin-password.txt';
export const HANDOVER_NOTE = 'READ-ME-FIRST.txt';
export const INSTALLER_STATE_SCHEMA = 1;
export const STAGES = Object.freeze([
    'release',
    'provision',
    'services',
    'trust',
    'admin',
    'tasks',
    'shortcut',
]);

/** Windows 11 is build 22000 or later (ARCHITECTURE.md platform). */
export const MIN_WINDOWS_BUILD = 22000;
/** .NET Framework 4.6.1 `Release` value, WinSW NET461's requirement. */
export const MIN_DOTNET_RELEASE = 394254;
/**
 * Free space required before anything is written. Provisional figures
 * (#357 qualification measures the real ones): the release twice (a
 * repair copies beside the old one) and room for the database, 30 days of
 * backups and logs on the data volume.
 */
export const MIN_FREE = Object.freeze({
    releaseFactor: 2,
    dataBytes: 5 * 1024 ** 3,
});
export const DEFAULT_BACKUP_TIME = '22:00';
export const DEFAULT_REMINDER = Object.freeze({ day: 'Monday', time: '09:00' });

/** Default locations from the Windows environment. */
export function locations(env) {
    const programFiles = env.ProgramFiles ?? 'C:\\Program Files';
    const programData = env.ProgramData ?? 'C:\\ProgramData';
    const publicDir = env.PUBLIC ?? 'C:\\Users\\Public';
    const programDir = join(programFiles, VENDOR_DIR, PRODUCT_DIR);
    return {
        programDir,
        releasesDir: join(programDir, 'releases'),
        lock: join(programDir, 'installer.lock'),
        dataRoot: join(programData, VENDOR_DIR, PRODUCT_DIR),
        // Outside the data root (never in backups) and never in a shared
        // folder such as C:\Users\Public: SYSTEM and Administrators only.
        handoverDir: join(programData, VENDOR_DIR, `${PRODUCT_DIR}-Handover`),
        shortcuts: shortcutPlaces(publicDir, programData, SHORTCUT_NAME),
        backupShortcuts: shortcutPlaces(
            publicDir,
            programData,
            BACKUP_SHORTCUT_NAME,
        ),
        checkShortcuts: shortcutPlaces(
            publicDir,
            programData,
            CHECK_SHORTCUT_NAME,
        ),
        // The guide: common Start menu only (owner decision 2026-11-15).
        helpShortcuts: [startMenu(programData, HELP_SHORTCUT_NAME)],
        // Next to it, common Start menu only (owner decision, #366).
        ownerGuideShortcuts: [
            startMenu(programData, OWNER_GUIDE_SHORTCUT_NAME),
        ],
    };
}

function startMenu(programData, name) {
    return join(
        programData,
        'Microsoft',
        'Windows',
        'Start Menu',
        'Programs',
        name,
    );
}

/** Every shortcut the installer creates (uninstall removes them all). */
export function allShortcuts(loc) {
    return [
        ...loc.shortcuts,
        ...loc.backupShortcuts,
        ...loc.checkShortcuts,
        ...loc.helpShortcuts,
        ...loc.ownerGuideShortcuts,
    ];
}

/** Public Desktop and the common Start menu (owner decision 2026-11-15). */
function shortcutPlaces(publicDir, programData, name) {
    return [
        join(publicDir, 'Desktop', name),
        join(
            programData,
            'Microsoft',
            'Windows',
            'Start Menu',
            'Programs',
            name,
        ),
    ];
}

/** The per-service virtual account (no password, no logon rights). */
export function serviceAccount(name) {
    return `NT SERVICE\\${name}`;
}

/**
 * Preflight decision from collected facts. Returns refusals (nothing may be
 * written) and warnings. `mode` is install, repair or uninstall.
 */
export function evaluatePreflight(facts, mode) {
    const refusals = [];
    const warnings = [];
    if (facts.platform !== 'win32') refusals.push('Windows 11 is required.');
    if (!(facts.osBuild >= MIN_WINDOWS_BUILD)) {
        refusals.push(
            `Windows 11 (build ${MIN_WINDOWS_BUILD} or later) is required; found build ${facts.osBuild ?? 'unknown'}.`,
        );
    }
    if (facts.osArchitecture !== 'X64') {
        refusals.push(
            `An Intel/AMD x64 PC is required; found ${facts.osArchitecture ?? 'unknown'}.`,
        );
    }
    if (facts.serverEdition) {
        refusals.push('Windows Server is not supported; use Windows 11.');
    }
    if (!facts.isAdmin) refusals.push('Run the installer as an administrator.');
    if (mode === 'uninstall') return { refusals, warnings };

    if (!(facts.dotNetRelease >= MIN_DOTNET_RELEASE)) {
        refusals.push('.NET Framework 4.6.1 or later is required (WinSW).');
    }
    if (facts.dataRoot === 'foreign') {
        refusals.push(
            'The data folder exists but is not a Grocery POS installation; nothing was changed.',
        );
    }
    const installed = facts.servicesInstalled ?? [];
    if (mode === 'install' && installed.length) {
        refusals.push(
            'Grocery POS services are already installed; use repair instead.',
        );
    }
    if (mode === 'repair' && facts.dataRoot !== 'ours') {
        refusals.push('There is no Grocery POS installation to repair.');
    }
    // LAN terminals (#396): the fixed IP must be on a local network adapter
    // and its HTTPS port free (our own proxy may hold it during a repair).
    if (facts.lanIp) {
        // Only a new or changed IP is refused when missing: a kept one may
        // be briefly absent (cable, router off), and refusing it would block
        // repair, upgrade and rollback until the network is back.
        if (!facts.lanIpPresent && facts.lanIpChanged) {
            refusals.push(
                `The LAN IP ${facts.lanIp} is not an address of this PC. Give this PC that fixed address (static or a router reservation) first, or choose another with --lan-ip.`,
            );
        } else if (!facts.lanIpPresent) {
            warnings.push(
                `The LAN IP ${facts.lanIp} is not an address of this PC right now (cable, Wi-Fi or router off?). LAN terminals cannot connect until it is back.`,
            );
        }
        if (facts.lanIpMultiple) {
            warnings.push(
                `The LAN IP ${facts.lanIp} is on more than one network adapter; keep it on one.`,
            );
        }
        if (facts.lanPortForeign) {
            refusals.push(
                `Port ${PORTS.proxy} on ${facts.lanIp} is in use by another program; free it.`,
            );
        }
        if (facts.lanProfile === 'Public') {
            warnings.push(
                `The network adapter with ${facts.lanIp} is on the Public profile, where the firewall rule does not apply. Set that network to Private in Windows Settings so terminals can connect.`,
            );
        }
    }
    for (const [name, port] of Object.entries(PORTS)) {
        const owner = {
            proxy: SERVICES.proxy,
            api: SERVICES.api,
            mongo: SERVICES.mongo,
        }[name];
        // Our own installed service may hold its port during a repair; a
        // listener outside our releases never may.
        if (
            facts.portsForeign?.includes(port) ||
            (facts.portsBusy?.includes(port) && !installed.includes(owner))
        ) {
            refusals.push(
                `Port ${port} is in use by another program; free it (it is never moved).`,
            );
        }
    }
    const needProgram = (facts.releaseBytes ?? 0) * MIN_FREE.releaseFactor;
    if (
        facts.freeBytes?.program !== undefined &&
        facts.freeBytes.program < needProgram
    ) {
        refusals.push(
            `Not enough free disk space for the program files (${gib(needProgram)} needed).`,
        );
    }
    if (
        facts.freeBytes?.data !== undefined &&
        facts.freeBytes.data < MIN_FREE.dataBytes
    ) {
        refusals.push(
            `Not enough free disk space for data and backups (${gib(MIN_FREE.dataBytes)} needed).`,
        );
    }
    if (!facts.chrome) {
        warnings.push(
            'Google Chrome was not found. Install it before handing over; the shortcut opens Chrome.',
        );
    }
    return { refusals, warnings };
}

function gib(bytes) {
    return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

/**
 * Service registration steps in start order (MongoDB → API → proxy). Each
 * step is `{ kind, ... }`: `exec` (file, args), `write` (path, text).
 */
export function serviceSteps(paths, release, serviceDir) {
    const bin = releaseLayout(release);
    const defs = serviceDefinitions(paths, release);
    const steps = [];
    for (const def of defs) {
        if (def.host === 'mongod') {
            steps.push({
                kind: 'exec',
                file: bin.mongod,
                args: [
                    ...def.arguments,
                    '--install',
                    '--serviceName',
                    def.name,
                    '--serviceDisplayName',
                    `${PRODUCT} database`,
                ],
            });
        } else {
            const exe = join(serviceDir, `${def.name}.exe`);
            steps.push({
                kind: 'copy',
                from: join(release, 'services', 'WinSW.exe'),
                to: exe,
            });
            steps.push({
                kind: 'write',
                path: join(serviceDir, `${def.name}.xml`),
                text: winswXml(def),
            });
            steps.push({ kind: 'exec', file: exe, args: ['install'] });
        }
        steps.push(...serviceConfigSteps(def));
    }
    return steps;
}

/** Identity, start mode, dependency and recovery for one registered service. */
export function serviceConfigSteps(def) {
    const depend = def.dependsOn.length ? def.dependsOn.join('/') : '/';
    return [
        // A virtual account (NT SERVICE\<name>) needs the service's own SID.
        {
            kind: 'exec',
            file: 'sc.exe',
            args: ['sidtype', def.name, 'unrestricted'],
        },
        {
            kind: 'exec',
            file: 'sc.exe',
            args: [
                'config',
                def.name,
                'obj=',
                serviceAccount(def.name),
                'start=',
                'auto',
                'depend=',
                depend,
            ],
        },
        // Bounded backoff, same as the WinSW definitions: 10 s, 30 s, then
        // every 60 s; the failure count resets after an hour.
        {
            kind: 'exec',
            file: 'sc.exe',
            args: [
                'failure',
                def.name,
                'reset=',
                '3600',
                'actions=',
                'restart/10000/restart/30000/restart/60000',
            ],
        },
        // Also restart after a non-crash exit with an error code.
        {
            kind: 'exec',
            file: 'sc.exe',
            args: ['failureflag', def.name, '1'],
        },
    ];
}

/**
 * icacls grants per service identity (runtime README "Permissions"), on
 * top of provisioning's SYSTEM + Administrators only. `(OI)(CI)M` is
 * modify on a folder and everything below it; `(R)` read on one file.
 */
export function aclSteps(paths, release) {
    const bin = releaseLayout(release);
    const grant = (path, account, rights) => ({
        kind: 'exec',
        file: 'icacls.exe',
        args: [path, '/grant', `${account}:${rights}`],
    });
    const mongo = serviceAccount(SERVICES.mongo);
    const api = serviceAccount(SERVICES.api);
    const proxy = serviceAccount(SERVICES.proxy);
    return [
        grant(paths.dirs.database, mongo, '(OI)(CI)M'),
        grant(paths.dirs.logs, mongo, '(OI)(CI)M'),
        grant(paths.dirs.config, mongo, '(OI)(CI)RX'),
        grant(paths.secrets.mongoKeyfile, mongo, '(R)'),
        grant(paths.apiEnv, api, '(R)'),
        grant(paths.apiLogs, api, '(OI)(CI)M'),
        grant(paths.dirs.tls, proxy, '(OI)(CI)M'),
        // The generated LAN site (#396) lives in config (no secrets there).
        grant(paths.dirs.config, proxy, '(OI)(CI)RX'),
        grant(paths.proxyLogs, proxy, '(OI)(CI)M'),
        grant(bin.client, proxy, '(OI)(CI)RX'),
    ];
}

/** Handover folder: inheritance removed, SYSTEM and Administrators only. */
export function handoverAclSteps(handoverDir) {
    return [
        {
            kind: 'exec',
            file: 'icacls.exe',
            args: [
                handoverDir,
                '/inheritance:r',
                '/grant:r',
                '*S-1-5-18:(OI)(CI)F',
                '/grant:r',
                '*S-1-5-32-544:(OI)(CI)F',
            ],
        },
    ];
}

/** Caddy's internal root under the proxy's XDG_DATA_HOME (tls\data). */
export function caddyRootCertificate(paths) {
    return join(
        paths.caddyData,
        'caddy',
        'pki',
        'authorities',
        'local',
        'root.crt',
    );
}

/** The Windows Firewall rule for LAN terminals (#396). */
export const FIREWALL_RULE = 'GroceryPOS-LAN-HTTPS';

/**
 * Inbound TCP 1443 to this release's caddy.exe on the LAN IP only, from the
 * local subnet, Private profile only. Always deletes the previous rule first
 * (another release's path or IP); without a LAN IP the rule stays deleted.
 */
export function firewallSteps(release, lanIp) {
    const steps = [removeFirewallStep()];
    if (!lanIp) return steps;
    steps.push({
        kind: 'exec',
        file: 'netsh.exe',
        args: [
            'advfirewall',
            'firewall',
            'add',
            'rule',
            `name=${FIREWALL_RULE}`,
            'dir=in',
            'action=allow',
            'protocol=TCP',
            `localport=${PORTS.proxy}`,
            `localip=${lanIp}`,
            'remoteip=localsubnet',
            'profile=private',
            `program=${releaseLayout(release).caddy}`,
            'enable=yes',
        ],
    });
    return steps;
}

function removeFirewallStep() {
    return {
        kind: 'exec',
        file: 'netsh.exe',
        args: [
            'advfirewall',
            'firewall',
            'delete',
            'rule',
            `name=${FIREWALL_RULE}`,
        ],
        // "No rules match" is not a failure.
        allowFailure: true,
    };
}

/** Machine trust store (Chrome on Windows uses the OS store). */
export function trustSteps(paths) {
    return [
        {
            kind: 'exec',
            file: 'certutil.exe',
            args: ['-addstore', '-f', 'Root', caddyRootCertificate(paths)],
        },
    ];
}

/** Removes the trust only when asked (`--remove-ca-trust`). */
export function untrustSteps(serialNumber) {
    return [
        {
            kind: 'exec',
            file: 'certutil.exe',
            args: ['-delstore', 'Root', serialNumber],
        },
    ];
}

function xmlEscape(text) {
    return String(text)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;');
}

/** `HH:MM`, 24-hour. */
export function parseTime(text) {
    const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(text ?? '');
    if (!match) throw new Error('Times are HH:MM (24-hour).');
    return `${match[1]}:${match[2]}`;
}

/** The scheduled backup command (#363 interface: `create --kind scheduled`). */
export function backupCommand(paths, release) {
    const bin = releaseLayout(release);
    return {
        file: bin.node,
        args: [
            join(release, 'tools', 'backup', 'backup.mjs'),
            'create',
            '--data-root',
            paths.root,
            '--mongod',
            bin.mongod,
            '--tools',
            join(release, 'mongodb', 'bin'),
            '--api',
            bin.api,
            '--kind',
            'scheduled',
        ],
        workingDirectory: release,
    };
}

function quote(arg) {
    return /[\s"]/.test(arg) ? `"${arg.replaceAll('"', '\\"')}"` : arg;
}

function taskXml({ description, trigger, principal, settings, action }) {
    return [
        '<?xml version="1.0" encoding="UTF-16"?>',
        '<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">',
        '  <RegistrationInfo>',
        `    <Description>${xmlEscape(description)}</Description>`,
        '  </RegistrationInfo>',
        '  <Triggers>',
        ...trigger.map((line) => `    ${line}`),
        '  </Triggers>',
        '  <Principals>',
        '    <Principal id="Author">',
        ...principal.map((line) => `      ${line}`),
        '    </Principal>',
        '  </Principals>',
        '  <Settings>',
        '    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>',
        '    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>',
        '    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>',
        '    <AllowHardTerminate>true</AllowHardTerminate>',
        // A PC that was off at the scheduled time runs it at next boot.
        '    <StartWhenAvailable>true</StartWhenAvailable>',
        '    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>',
        '    <IdleSettings>',
        '      <StopOnIdleEnd>false</StopOnIdleEnd>',
        '      <RestartOnIdle>false</RestartOnIdle>',
        '    </IdleSettings>',
        '    <AllowStartOnDemand>true</AllowStartOnDemand>',
        '    <Enabled>true</Enabled>',
        '    <Hidden>false</Hidden>',
        '    <RunOnlyIfIdle>false</RunOnlyIfIdle>',
        '    <WakeToRun>false</WakeToRun>',
        ...settings.map((line) => `    ${line}`),
        '  </Settings>',
        '  <Actions Context="Author">',
        '    <Exec>',
        `      <Command>${xmlEscape(action.file)}</Command>`,
        `      <Arguments>${xmlEscape(action.args.map(quote).join(' '))}</Arguments>`,
        ...(action.workingDirectory
            ? [
                  `      <WorkingDirectory>${xmlEscape(action.workingDirectory)}</WorkingDirectory>`,
              ]
            : []),
        '    </Exec>',
        '  </Actions>',
        '</Task>',
        '',
    ].join('\r\n');
}

/** Daily backup as SYSTEM (it reads secrets\ and writes backups\). */
export function backupTaskXml(paths, release, time = DEFAULT_BACKUP_TIME) {
    return taskXml({
        description:
            'Grocery POS: daily verified local backup (backup.mjs create --kind scheduled).',
        trigger: [
            '<CalendarTrigger>',
            `  <StartBoundary>2026-01-01T${parseTime(time)}:00</StartBoundary>`,
            '  <Enabled>true</Enabled>',
            '  <ScheduleByDay><DaysInterval>1</DaysInterval></ScheduleByDay>',
            '</CalendarTrigger>',
        ],
        principal: [
            '<UserId>S-1-5-18</UserId>',
            '<RunLevel>HighestAvailable</RunLevel>',
        ],
        settings: [
            '<ExecutionTimeLimit>PT2H</ExecutionTimeLimit>',
            '<Priority>7</Priority>',
            '<RestartOnFailure><Interval>PT30M</Interval><Count>3</Count></RestartOnFailure>',
        ],
        action: backupCommand(paths, release),
    });
}

/** `HH:MM` plus minutes, wrapping past midnight. */
export function addMinutes(time, minutes) {
    const [h, m] = parseTime(time).split(':').map(Number);
    const total = (((h * 60 + m + minutes) % 1440) + 1440) % 1440;
    return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/** The nightly mongod log rotation (#365 `rotate-logs`, keeps 5). */
export function logRotationCommand(paths, release) {
    const bin = releaseLayout(release);
    return {
        file: bin.node,
        args: [
            join(release, 'tools', 'diagnostics', 'diagnose.mjs'),
            'rotate-logs',
            '--data-root',
            paths.root,
            '--api',
            bin.api,
        ],
        workingDirectory: release,
    };
}

/**
 * Nightly log rotation as SYSTEM (it reads the MongoDB root password),
 * `LOG_ROTATION_DELAY_MINUTES` after the daily backup starts. It only
 * rotates and prunes mongod.log files.
 */
export function logRotationTaskXml(
    paths,
    release,
    backupTime = DEFAULT_BACKUP_TIME,
) {
    return taskXml({
        description:
            'Grocery POS: nightly database log rotation (diagnose.mjs rotate-logs).',
        trigger: [
            '<CalendarTrigger>',
            `  <StartBoundary>2026-01-01T${addMinutes(backupTime, LOG_ROTATION_DELAY_MINUTES)}:00</StartBoundary>`,
            '  <Enabled>true</Enabled>',
            '  <ScheduleByDay><DaysInterval>1</DaysInterval></ScheduleByDay>',
            '</CalendarTrigger>',
        ],
        principal: [
            '<UserId>S-1-5-18</UserId>',
            '<RunLevel>HighestAvailable</RunLevel>',
        ],
        settings: [
            '<ExecutionTimeLimit>PT10M</ExecutionTimeLimit>',
            '<Priority>7</Priority>',
        ],
        action: logRotationCommand(paths, release),
    });
}

/** Weekly reminder shown to whoever is logged on (no elevation). */
export function reminderTaskXml(release, reminder = DEFAULT_REMINDER) {
    const days = [
        'Monday',
        'Tuesday',
        'Wednesday',
        'Thursday',
        'Friday',
        'Saturday',
        'Sunday',
    ];
    if (!days.includes(reminder.day)) throw new Error('Unknown weekday.');
    return taskXml({
        description:
            'Grocery POS: weekly reminder to export a backup to an external drive.',
        trigger: [
            '<CalendarTrigger>',
            `  <StartBoundary>2026-01-05T${parseTime(reminder.time)}:00</StartBoundary>`,
            '  <Enabled>true</Enabled>',
            '  <ScheduleByWeek>',
            '    <WeeksInterval>1</WeeksInterval>',
            `    <DaysOfWeek><${reminder.day} /></DaysOfWeek>`,
            '  </ScheduleByWeek>',
            '</CalendarTrigger>',
        ],
        principal: [
            '<GroupId>S-1-5-32-545</GroupId>',
            '<RunLevel>LeastPrivilege</RunLevel>',
        ],
        settings: ['<ExecutionTimeLimit>PT10M</ExecutionTimeLimit>'],
        action: powershellFile(
            join(release, 'tools', 'installer', 'ExportReminder.ps1'),
        ),
    });
}

/** Hidden, non-interactive Windows PowerShell 5.1 running one script. */
export function powershellFile(script, extra = []) {
    return {
        file: 'powershell.exe',
        args: [
            '-NoProfile',
            '-NonInteractive',
            '-WindowStyle',
            'Hidden',
            '-ExecutionPolicy',
            'Bypass',
            '-File',
            script,
            ...extra,
        ],
    };
}

/** The daily-use shortcut: waits for readiness, then opens Chrome. */
export function shortcutSpec(release) {
    const launch = powershellFile(
        join(release, 'tools', 'installer', 'Launch.ps1'),
        ['-Origin', ORIGIN],
    );
    return {
        target: launch.file,
        arguments: launch.args.map(quote).join(' '),
        workingDirectory: release,
        description: `Open ${PRODUCT} in Google Chrome`,
        icon: join(release, 'client', 'favicon.ico'),
    };
}

/**
 * "Back up to USB drive": BackupToUsb.ps1 asks for elevation, takes a
 * verified backup (`create --kind manual`) and exports it with the #363
 * `export` command to the removable drive the owner picks.
 */
export function backupShortcutSpec(paths, release) {
    const run = powershellFile(
        join(release, 'tools', 'installer', 'BackupToUsb.ps1'),
        ['-DataRoot', paths.root, '-Release', release],
    );
    return {
        target: run.file,
        arguments: run.args.map(quote).join(' '),
        workingDirectory: release,
        description: `Back up ${PRODUCT} to a USB drive`,
        icon: join(release, 'client', 'favicon.ico'),
    };
}

/**
 * "Check Grocery POS": CheckHealth.ps1 asks for elevation (a standard
 * account may decline and gets a partial check), runs `diagnose.mjs
 * check`, shows the result with recovery steps, points to the guide and
 * offers the owner-made support export (#365).
 */
export function checkShortcutSpec(paths, release) {
    const run = powershellFile(
        join(release, 'tools', 'installer', 'CheckHealth.ps1'),
        ['-DataRoot', paths.root, '-Release', release],
    );
    return {
        target: run.file,
        arguments: run.args.map(quote).join(' '),
        workingDirectory: release,
        description: `Check ${PRODUCT} and show what to do`,
        icon: join(release, 'client', 'favicon.ico'),
    };
}

/** "Grocery POS help": the recovery guide in Notepad (plain text). */
export function helpShortcutSpec(release) {
    return {
        target: 'notepad.exe',
        arguments: quote(join(release, 'help', 'RECOVERY.md')),
        workingDirectory: release,
        description: `${PRODUCT}: what to do when something goes wrong`,
        icon: join(release, 'client', 'favicon.ico'),
    };
}

/** "Grocery POS owner guide": the handover guide in Notepad (#366). */
export function ownerGuideShortcutSpec(release) {
    return {
        target: 'notepad.exe',
        arguments: quote(join(release, 'help', 'HANDOVER.md')),
        workingDirectory: release,
        description: `${PRODUCT}: owner guide`,
        icon: join(release, 'client', 'favicon.ico'),
    };
}

/**
 * Old releases a repair may delete: everything except the current one and
 * the newest other complete release (`KEEP_RELEASES`); damaged and partial
 * copies always go. `entries` are `{ name, mtimeMs }` in releases\.
 */
export function releasesToPrune(entries, current) {
    const complete = entries
        .filter(
            (e) =>
                e.name !== current && !/\.(damaged-\d+|partial)$/.test(e.name),
        )
        .sort((a, b) => b.mtimeMs - a.mtimeMs);
    const keep = new Set([
        current,
        ...complete.slice(0, KEEP_RELEASES - 1).map((e) => e.name),
    ]);
    return entries.map((e) => e.name).filter((name) => !keep.has(name));
}

/** schtasks steps; XML files are written UTF-16 by install.mjs. */
export function taskSteps(xmlPaths) {
    return Object.entries(TASKS).map(([key, name]) => ({
        kind: 'exec',
        file: 'schtasks.exe',
        args: ['/Create', '/TN', name, '/XML', xmlPaths[key], '/F'],
    }));
}

/** Stop order: proxy → API → MongoDB (reverse of start). */
export function stopOrder() {
    return [SERVICES.proxy, SERVICES.api, SERVICES.mongo];
}

/**
 * Uninstall removes what the installer registered and the release binaries
 * only. Kept: the data root (database, secrets, TLS state, backups, logs),
 * the handover folder, the CA trust (unless asked) and every Chrome profile.
 */
export function uninstallSteps({ installedServices, shortcuts }) {
    const steps = [];
    for (const name of Object.values(TASKS)) {
        steps.push({
            kind: 'exec',
            file: 'schtasks.exe',
            args: ['/Delete', '/TN', name, '/F'],
            allowFailure: true,
        });
    }
    for (const name of stopOrder()) {
        if (!installedServices.includes(name)) continue;
        steps.push({ kind: 'stop', name });
        steps.push({ kind: 'exec', file: 'sc.exe', args: ['delete', name] });
        steps.push({ kind: 'gone', name });
    }
    steps.push(removeFirewallStep());
    for (const path of shortcuts) steps.push({ kind: 'remove', path });
    return steps;
}
