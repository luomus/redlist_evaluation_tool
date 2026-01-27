#!/bin/bash
set -e

echo "Waiting for database to be ready..."
# Wait for database to be ready
until python -c "from models import engine; engine.connect()" 2>/dev/null; do
    echo "Database not ready, waiting..."
    sleep 2
done

echo "Database is ready, initializing tables..."
python init_database.py

echo "Starting application..."
exec "$@"
