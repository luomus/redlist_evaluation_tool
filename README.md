# Red List Evaluation tool

## Setup and Usage

Create a `.env` file in the project root (or set environment variables). Required variables:

- `LAJI_API_ACCESS_TOKEN` (optional): API access token for fetching data from laji.fi (later will implement the use of access_token from laji-auth)
- `LAJI_API_BASE_URL` (optional): Base URL for laji.fi API (default: https://api.laji.fi)
- `MML_API_KEY` (optional): Maanmittauslaitos API key used by the server tile-proxy for `taustakartta` and `maastokartta`. Get one: https://omatili.maanmittauslaitos.fi/user/profile
- `TARGET` (required for login flow): target (system identifier) parameter sent to laji-auth login
- `LAJIAUTH_URL` (optional): base URL for laji-auth (default: https://fmnh-ws-test-24.it.helsinki.fi/laji-auth/)
- `SECRET_KEY` (required): Flask secret key used to sign sessions
- `SHARED_SECRET` (required when `USE_AUTHENTICATION=true`): Base64-encoded AES-GCM key shared with the IUCN editor for decrypting map access tokens
- `SECRET_TIMEOUT_PERIOD` (optional): request timeout seconds when contacting laji-auth (default: 10)

The application will load variables from `.env` automatically. Do not commit secrets.

The app uses PostgreSQL/PostGIS for data storage. Use docker-compose to run both the database and web app:

```bash
chmod +x docker-entrypoint.sh
docker-compose up --build
```

or on Linux:

```bash
sudo systemctl start docker
docker-compose up --build
```

On first start the entrypoint automatically:
1. Creates all tables
2. Generates the Finland base grid

Individual taxons row is created on first visit to `/map/<mx_id>`, using the display name and IUCN 2019 red list category fetched from the laji.fi `/taxa/<mx_id>` endpoint.

All steps are idempotent — safe to run multiple times.

Access the app at `http://localhost:5000/` for local development. In production, open a species map through the IUCN editor.

## Public area API

`GET /api/values/<mx_id>/<metric>` returns saved area values in km2.
This read-only endpoint is public, even when `USE_AUTHENTICATION=true`.
It does not create taxa, fetch observations, or recalculate values.

- `/api/values/MX.12345/aoo` returns a JSON number, for example `128`.
  AOO is the saved number of occupied 2 km grid cells multiplied by 4 km2.
- `/api/values/MX.12345/eoo` returns both saved EOO areas, for example
  `{"max": 250.5, "min": 180.25}`.

The metric must be lowercase `aoo` or `eoo`; other metrics return HTTP 400.
An unknown taxon or missing calculation returns HTTP 404. EOO requires both
`max` and `min` values. A saved zero is returned as zero, not treated as missing.
Database failures return HTTP 500. Errors contain a JSON object with
`success: false` and an `error` message.

Values reflect the last saved calculation and may be outdated if observations
have changed since then. Successful responses contain only the number or the
two EOO values, with no geometry or other metadata.

To stop:
```bash
docker-compose down
```

To remove all data (including database):
```bash
docker-compose down -v
```
