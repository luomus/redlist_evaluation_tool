from flask import Flask, render_template, jsonify
from livereload import Server
from config import LAJI_API_ACCESS_TOKEN, LAJI_API_BASE_URL

app = Flask(__name__)
app.debug = True

@app.route("/")
@app.route("/simple")
def simple():
    return render_template("simple.html")

@app.route("/stats")
def stats():
    return render_template("stats.html")

@app.route("/raw")
def raw():
    return render_template("raw.html")
    
@app.route("/convex_hull")
def convex_hull():
    return render_template("convex_hull.html")

@app.route("/api/config")
def get_config():
    return jsonify({
        "access_token": LAJI_API_ACCESS_TOKEN,
        "base_url": LAJI_API_BASE_URL
    })

if __name__ == "__main__":
    server = Server(app.wsgi_app)
    server.watch("templates/*.html")
    server.watch("static/*.js")
    server.serve(port=5000, host="0.0.0.0")
