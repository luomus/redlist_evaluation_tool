````markdown

# BioTools

<img src="./static/capybara_250.png" alt="BioTools Logo" width="250" style="float: right; margin: 0 0 20px 20px;">

**BioTools** is a collection of web-based tools for analyzing biodiversity data from [Laji.fi](https://laji.fi), Finland's biodiversity data portal. It demonstrates an app gallery concept where users can access various data analysis tools through a unified interface.

- **Data Fetching**: Automated data retrieval from Laji.fi API
- **Interactive Tools**: Web-based analysis tools for biodiversity data
- **Local Development**: Easy setup for local testing and development
- **Friendly and Smart Capybara**: Because a capybara staring at you makes you happy.

**Starting point copied from:** https://github.com/mikkohei13/biotools/tree/main

## Setup and Usage

### First time setup (local/Python)

```bash
python3.10 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

### Daily Usage (local/Python)

```bash
source venv/bin/activate
python app.py
```
Access the app at http://localhost:5000/simple

```bash
deactivate
```

### Docker (recommended for quick start)

Build the image:

```bash
docker build -t biotools .
```

Run the container (Linux/macOS):

```bash
docker run --rm -p 5000:5000 -v $(pwd)/config:/app/config biotools:latest
```

Run the container (Windows PowerShell):

```powershell
docker run --rm -p 5000:5000 biotools
```

### Docker with PostGIS (recommended)

The app now uses PostgreSQL/PostGIS for data storage. Use docker-compose to run both the database and web app:

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

#### Database Initialization

The database tables are automatically created on first startup via the `docker-entrypoint.sh` script and `init_database.py`. If you ever need to manually reinitialize:

```bash
# Inside the running web container
docker exec -it biotools-main-web-1 python init_database.py

# Or directly via SQL
Get-Content create_tables.sql | docker exec -i biotools-main-db-1 psql -U biotools -d biotools
```

**Troubleshooting**: If you get "relation does not exist" errors:
1. Check if containers are running: `docker ps`
2. Verify tables exist: `docker exec -it biotools-main-db-1 psql -U biotools -d biotools -c "\dt"`
3. Recreate tables: `docker exec -it biotools-main-web-1 python init_database.py`

### Package Management

```bash
pip install package_name
pip freeze > requirements.txt
```

```bash
pip install -r requirements.txt
```

## Command line tools

# List available configurations
    python generate_map.py --list

# Run a specific configuration
    python generate_map.py --config heteroptera_chao1_100km

# Run multiple configurations
    python generate_map.py --config heteroptera_chao1_100km kaskaat_chao1_100km

# Run all configurations
    python generate_map.py --all

````
