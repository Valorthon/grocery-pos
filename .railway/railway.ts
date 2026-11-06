// Railway infrastructure for this repo (#92). Replaces the deprecated
// apps/*/railway.json config-as-code files, which Railway stops reading on
// 2026-12-01 and refuses for new services. See docs/DEPLOY.md.
//
// Railway never reads this file during a deploy. Preview and apply it by hand
// against one environment:
//
//   railway config plan --environment staging
//   railway config apply --environment staging
//
// Variables are unmanaged: secrets and URLs stay in each service's Railway
// variables (docs/DEPLOY.md lists them), never in this file.
import {
    defineRailway,
    github,
    image,
    project,
    service,
    volume,
} from 'railway/iac';

// The parent of both hostnames is the cookie domain (`DOMAIN` and
// `VITE_DOMAIN`). Staging gets its own parent, so its cookies never reach
// production's hosts.
const ENVIRONMENTS = {
    staging: { branch: 'staging', domain: 'staging.pos.valorthon.store' },
    production: { branch: 'production', domain: 'pos.valorthon.store' },
} as const;

// A build of either image needs packages/contracts and the workspace files.
const SHARED_WATCH = [
    '/packages/contracts/**',
    '/pnpm-lock.yaml',
    '/package.json',
    '/pnpm-workspace.yaml',
    '/.dockerignore',
];

// Single-node replica set (transactions need one) with a keyfile, so auth
// can stay on. The keyfile is created once on the volume.
const MONGO_START =
    "bash -c 'set -e; KF=/data/db/rs.key; " +
    'if [ ! -f $KF ]; then head -c 756 /dev/urandom | base64 -w0 > $KF; fi; ' +
    'chmod 400 $KF; chown 999:999 $KF; ' +
    "exec docker-entrypoint.sh mongod --replSet rs0 --ipv6 --bind_ip_all --keyFile $KF'";

export default defineRailway((ctx) => {
    const name = ctx.environment;
    if (name !== 'staging' && name !== 'production') {
        throw new Error(
            `No Railway settings for environment "${name}" (staging, production)`,
        );
    }
    const env = ENVIRONMENTS[name];
    const repo = github('Valorthon/grocery-pos', {
        branch: env.branch,
        checkSuites: false,
    });

    const mongoVolume = volume('mongo-volume', {
        alerts: { usage: { '80': {}, '95': {}, '100': {} } },
        allowOnlineResize: true,
        region: 'us-west2',
        sizeMB: 5000,
    });
    const mongo = service('mongo', {
        source: image('mongo:7.0'),
        build: { buildEnvironment: 'V3', builder: 'RAILPACK' },
        start: MONGO_START,
        replicas: { 'us-west2': 1 },
        volumeMounts: { '/data/db': mongoVolume },
    });

    const api = service('api', {
        source: repo,
        build: {
            buildEnvironment: 'V3',
            builder: 'DOCKERFILE',
            dockerfilePath: 'apps/api/Dockerfile',
            watchPatterns: ['/apps/api/**', ...SHARED_WATCH],
        },
        healthcheck: '/v1/health/live',
        healthcheckTimeout: 300,
        replicas: { 'us-west2': 1 },
        domains: [`api.${env.domain}`],
    });

    const client = service('client', {
        source: repo,
        build: {
            buildEnvironment: 'V3',
            builder: 'DOCKERFILE',
            dockerfilePath: 'apps/client/Dockerfile',
            watchPatterns: ['/apps/client/**', ...SHARED_WATCH],
        },
        healthcheck: '/health',
        healthcheckTimeout: 300,
        replicas: { 'us-west2': 1 },
        domains: [env.domain],
    });

    return project('grocery-pos', {
        variables: { managed: false },
        resources: [mongo, api, client, mongoVolume],
    });
});
