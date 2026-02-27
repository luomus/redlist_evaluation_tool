# Red List Evaluation tool

## Setup and Usage

Create a `.env` file in the project root (or set environment variables). Required variables:

- `LAJI_API_ACCESS_TOKEN` (optional): API access token for fetching data from laji.fi (later will implement the use of access_token from laji-auth)
- `LAJI_API_BASE_URL` (optional): Base URL for laji.fi API (default: https://api.laji.fi/warehouse/private-query/unit/list)
- `MML_API_KEY` (optional): Maanmittauslaitos API key used by the server tile-proxy for `taustakartta` and `maastokartta`. Get one: https://omatili.maanmittauslaitos.fi/user/profile
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

On first start the entrypoint automatically:
1. Creates all tables
2. Loads the taxon hierarchy from `static/resources/hierarchy.json`
3. Seeds species from `static/resources/species_and_groups.tsv` (includes IUCN 2019 categories)
4. Generates the Finland base grid

All steps are idempotent — safe to run multiple times.

Access the app at http://localhost:5000/simple

To stop:
```bash
docker-compose down
```

To remove all data (including database):
```bash
docker-compose down -v
```

## Data seeding

Species and their IUCN categories are seeded automatically on startup.  
To re-seed manually (e.g. after updating the TSV):

```bash
# locally (requires DB port 5432 mapped)
python seed_species.py

# or inside the running container
docker compose exec web python seed_species.py
```

The seeder skips existing species and prints a summary of inserted / skipped rows.

### OpenShift — adding new columns to an existing database

If you have an existing deployment that predates the `iucn_category` / `mx_id` columns, run the migration first:

```bash
oc exec <db-pod> -- psql -U biotools -d biotools \
  -f /dev/stdin < migrations/add_iucn_mx_id_to_projects.sql
```

Then trigger a re-seed:

```bash
oc exec <web-pod> -- python seed_species.py
```