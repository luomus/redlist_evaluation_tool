# Red List Evaluation tool

## Setup and Usage

Copy `config.example.py` to `config.py` and set `LAJI_API_ACCESS_TOKEN` and `LAJI_API_BASE_URL` (do not commit secrets).

The app uses PostgreSQL/PostGIS for data storage. Use docker-compose to run both the database and web app:

```bash
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