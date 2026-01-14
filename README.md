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

If you prefer docker-compose, use the provided file (named `docker-compose-yml` in this repo):

```bash
docker-compose -f docker-compose-yml up --build
```

Tip: You can rename `docker-compose-yml` to `docker-compose.yml` to use `docker-compose up --build` directly.

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
