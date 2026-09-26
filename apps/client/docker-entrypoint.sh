#!/bin/sh
set -e

if [ -z "$PORT" ]; then
    echo "PORT environment variable is required" >&2
    exit 1
fi
case "$PORT" in
    *[!0-9]*)
        echo "PORT must be a number, got '$PORT'" >&2
        exit 1
        ;;
esac

# The API origin for the CSP's connect-src. The bundle can only call the
# VITE_API_URL it was built with, so the image records that URL's origin at
# build time. A runtime API_ORIGIN overrides it; it is normally left unset.
BUILT_API_ORIGIN=$(cat /etc/nginx/api-origin 2>/dev/null || true)
API_ORIGIN=${API_ORIGIN:-$BUILT_API_ORIGIN}

# scheme://host[:port] only: the value goes into a response header.
if ! printf '%s' "$API_ORIGIN" | grep -Eq '^https?://[A-Za-z0-9.-]+(:[0-9]+)?$'; then
    echo "API_ORIGIN must be an origin like https://api.example.com (no path), got '$API_ORIGIN'" >&2
    exit 1
fi
if [ -n "$BUILT_API_ORIGIN" ] && [ "$API_ORIGIN" != "$BUILT_API_ORIGIN" ]; then
    echo "warning: API_ORIGIN=$API_ORIGIN differs from the origin this bundle was built for ($BUILT_API_ORIGIN); the app will call the latter" >&2
fi
export API_ORIGIN

# Rendered under /tmp: nginx runs unprivileged and cannot write /etc/nginx.
envsubst '${PORT} ${API_ORIGIN}' < /etc/nginx/nginx.conf.template > /tmp/nginx.conf

# Hosts without IPv6 (some local Docker setups) cannot bind [::]; nginx
# would refuse to start. Railway has IPv6, so the line stays there.
if [ ! -f /proc/net/if_inet6 ]; then
    sed -i '/listen \[::\]/d' /tmp/nginx.conf
fi

exec "$@"
