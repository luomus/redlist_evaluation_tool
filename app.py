from flask import Flask, render_template, request, jsonify
from livereload import Server
import csv
import io
from config import LAJI_API_ACCESS_TOKEN, LAJI_API_BASE_URL

app = Flask(__name__)
app.debug = True

@app.route("/heatmap")
def heatmap():
    return render_template("heatmap.html")

@app.route("/species_richness")
def species_richness():
    return render_template("species_richness.html")

@app.route("/search")
def search():
    return render_template("search.html")

@app.route("/simple")
def simple():
    return render_template("simple.html")

@app.route("/stats")
def stats():
    return render_template("stats.html")

@app.route("/raw")
def raw():
    return render_template("raw.html")

@app.route("/heatmap_db")
def heatmap_db():
    return render_template("heatmap_db.html")

@app.route("/convex_hull")
def convex_hull():
    return render_template("convex_hull.html")

@app.route("/2kmgrids")
def grid2km():
    return render_template("2kmgrids.html")

@app.route("/analyze")
def analyze():
    return render_template("analyze.html")

@app.route("/export_gpkg")
def export_gpkg():
    pass  # Placeholder for future implementation
    

@app.route("/api/config")
def get_config():
    return jsonify({
        "access_token": LAJI_API_ACCESS_TOKEN,
        "base_url": LAJI_API_BASE_URL
    })

@app.post("/api/upload")
def upload_tsv():
    if "file" not in request.files:
        return jsonify({"error": "No file part named 'file'"}), 400

    file = request.files["file"]
    if file.filename == "":
        return jsonify({"error": "No selected file"}), 400

    try:
        # Read as text safely from uploaded bytes
        raw_bytes = file.read()
        text = raw_bytes.decode("utf-8", errors="replace")
        reader = csv.DictReader(io.StringIO(text), delimiter="\t")

        points = []  # [lat, lon, weight]
        for row in reader:
            try:
                lat_str = (row.get("WGS84 N") or "").strip()
                lon_str = (row.get("WGS84 E") or "").strip()
                if not lat_str or not lon_str:
                    continue
                latitude = float(lat_str)
                longitude = float(lon_str)

                weight_value = 1.0
                count_str = (row.get("Individual count (interpreted)") or "").strip()
                if count_str:
                    try:
                        weight_value = float(count_str)
                    except ValueError:
                        weight_value = 1.0

                points.append([latitude, longitude, weight_value])
            except Exception:
                # Skip problematic rows silently
                continue

        if not points:
            return jsonify({"error": "No valid coordinates found in file"}), 400

        return jsonify({"points": points, "count": len(points)})
    except Exception as exc:
        return jsonify({"error": f"Failed to parse file: {exc}"}), 500


@app.post("/api/upload_richness")
def upload_tsv_richness():
    if "file" not in request.files:
        return jsonify({"error": "No file part named 'file'"}), 400

    file = request.files["file"]
    if file.filename == "":
        return jsonify({"error": "No selected file"}), 400

    try:
        raw_bytes = file.read()
        text = raw_bytes.decode("utf-8", errors="replace")
        reader = csv.DictReader(io.StringIO(text), delimiter="\t")

        records = []  # {lat, lon, name}
        for row in reader:
            try:
                lat_str = (row.get("WGS84 N") or "").strip()
                lon_str = (row.get("WGS84 E") or "").strip()
                name = (row.get("Scientific name") or "").strip()
                if not lat_str or not lon_str or not name:
                    # Skip rows without coordinates or scientific name
                    continue
                latitude = float(lat_str)
                longitude = float(lon_str)
                records.append({"lat": latitude, "lon": longitude, "name": name})
            except Exception:
                continue

        if not records:
            return jsonify({"error": "No valid records with coordinates and Scientific name found in file"}), 400

        return jsonify({"records": records, "count": len(records)})
    except Exception as exc:
        return jsonify({"error": f"Failed to parse file: {exc}"}), 500

if __name__ == "__main__":
    server = Server(app.wsgi_app)
    server.watch("templates/*.html")
    server.watch("static/*.js")
    server.serve(port=5000, host="0.0.0.0")
