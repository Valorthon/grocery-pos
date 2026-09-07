#!/bin/sh
set -e

if [ -z "$PORT" ]; then
    echo "PORT environment variable is required" >&2
    exit 1
fi

# substitute the PORT placeholder into the nginx configuration
envsubst '${PORT}' < /etc/nginx/nginx.conf.template > /etc/nginx/nginx.conf

exec "$@"
