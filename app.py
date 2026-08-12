from flask import Flask, render_template
from livereload import Server
from data_loaders.database import init_db

from config import (
    DEBUG, SECRET_KEY, LAJI_API_ACCESS_TOKEN, LAJI_API_BASE_URL,
    MML_API_KEY, MAX_CONTENT_LENGTH, get_flask_config
)
from cache import stats_cache
from utils.helpers import generate_id, project_to_dict
from auth.decorators import login_required
from auth.routes import auth_bp
from proxy.mml import bp as proxy_mml_bp
from proxy.laji import bp as proxy_laji_bp
from api.user import bp as api_user_bp
from api.taxons import bp as api_taxons_bp
from api.species import bp as api_species_bp
from api.observations import bp as api_observations_bp
from api.datasets import bp as api_datasets_bp
from api.stats import bp as api_stats_bp
from api.spatial import bp as api_spatial_bp


app = Flask(__name__)
app.debug = DEBUG

# Apply Flask configuration
app.config.update(get_flask_config())

# Register blueprints
app.register_blueprint(auth_bp)
app.register_blueprint(proxy_mml_bp)
app.register_blueprint(proxy_laji_bp)
app.register_blueprint(api_user_bp)
app.register_blueprint(api_taxons_bp)
app.register_blueprint(api_species_bp)
app.register_blueprint(api_observations_bp)
app.register_blueprint(api_datasets_bp)
app.register_blueprint(api_stats_bp)
app.register_blueprint(api_spatial_bp)

# Initialize database on startup
with app.app_context():
    init_db()


@app.route("/")
@app.route("/simple")
@login_required
def simple():
    return render_template("simple.html")

@app.route("/stats")
@login_required
def stats():
    return render_template("stats.html")
    
@app.route("/convex_hull")
@login_required
def convex_hull():
    return render_template("convex_hull.html")

@app.route("/grid")
@login_required
def grid():
    return render_template("convex_hull.html")


if __name__ == "__main__":
    server = Server(app.wsgi_app)
    server.watch("templates/*.html")
    server.watch("static/*.js")
    server.serve(port=5000, host="0.0.0.0")
