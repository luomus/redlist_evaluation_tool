# Red List Evaluation tool

## Setup and Usage

Create a `.env` file in the project root (or set environment variables). Required variables:

- `LAJI_API_ACCESS_TOKEN` (optional): API access token for fetching data from laji.fi (later will implement the use of access_token from laji-auth)
- `LAJI_API_BASE_URL` (optional): Base URL for laji.fi API (default: https://api.laji.fi/warehouse/private-query/unit/list)
- `TARGET` (required for login flow): target (system identifier) parameter sent to laji-auth login
- `LAJIAUTH_URL` (optional): base URL for laji-auth (default: https://fmnh-ws-test-24.it.helsinki.fi/laji-auth/)
- `SECRET_KEY` (required): Flask secret key used to sign sessions
- `SECRET_TIMEOUT_PERIOD` (optional): request timeout seconds when contacting laji-auth (default: 10)

The application will load variables from `.env` automatically. Do not commit secrets.

The app uses PostgreSQL/PostGIS for data storage. Use docker-compose to run both the database and web app:

```bash
chmod +x docker-entrypoint.sh
docker-compose up --build
```

Access the app at http://localhost:5000/simple

To stop:
```bash
docker-compose down
```

To remove all data (including database):
```bash
docker-compose down -v
```