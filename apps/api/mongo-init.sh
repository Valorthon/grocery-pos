#!/bin/bash
set -e

# Start mongod in the background
mongod --replSet rs0 --bind_ip_all &
MONGO_PID=$!

# Wait for mongod to be ready (max 60s)
for i in {1..60}; do
    if ! kill -0 "$MONGO_PID" 2>/dev/null; then
        echo "ERROR: mongod process died unexpectedly. Check the logs above for the actual error."
        exit 1
    fi
    if mongosh --host localhost --port 27017 --eval "db.adminCommand('ping')" >/dev/null 2>&1; then
        break
    fi
    echo "Waiting for MongoDB to start... ($i/60)"
    sleep 1
done

if ! mongosh --host localhost --port 27017 --eval "db.adminCommand('ping')" >/dev/null 2>&1; then
    echo "ERROR: mongod failed to start within 60 seconds."
    exit 1
fi

# Check if replica set is already initialized
RS_STATUS=$(mongosh --host localhost --port 27017 --quiet --eval "rs.status().ok" 2>/dev/null || echo "0")

if [ "$RS_STATUS" != "1" ]; then
    echo "Initializing replica set rs0..."
    mongosh --host localhost --port 27017 --quiet --eval '
        rs.initiate({
            _id: "rs0",
            members: [{ _id: 0, host: "localhost:27017" }]
        });
    '
    echo "Replica set initialized."
else
    echo "Replica set already initialized."
fi

# Trap shutdown signals and pass them to mongod for a graceful exit
trap 'kill -TERM $MONGO_PID; wait $MONGO_PID' SIGTERM SIGINT
wait "$MONGO_PID"
