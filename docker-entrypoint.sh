#!/bin/bash
set -e

echo "Waiting for database to be ready..."
# Wait for database to be ready
until python -c "from data_loaders.database import engine; engine.connect()" 2>&1; do
    echo "Database not ready, waiting..."
    sleep 2
done

echo "Database is ready, initializing tables..."
python -c "from data_loaders.database import init_db; init_db()"

echo "Starting application..."
exec "$@"
