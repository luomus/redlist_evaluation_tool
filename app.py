from flask import Flask, render_template, abort
from data_loaders.database import init_db, Session
from config import DEBUG, USE_AUTHENTICATION, get_flask_config
from auth.decorators import login_required
from proxy.mml import bp as proxy_mml_bp
from proxy.laji import bp as proxy_laji_bp
from api.observations import bp as api_observations_bp
from api.spatial import bp as api_spatial_bp
from utils.helpers import get_taxon_by_name
from models import Taxon

app = Flask(__name__)
app.debug = DEBUG
app.config.update(get_flask_config())
app.logger.info(f'Application started with USE_AUTHENTICATION={USE_AUTHENTICATION}')

if USE_AUTHENTICATION:
    from auth.routes import auth_bp
    app.register_blueprint(auth_bp)

app.register_blueprint(proxy_mml_bp)
app.register_blueprint(proxy_laji_bp)
app.register_blueprint(api_observations_bp)
app.register_blueprint(api_spatial_bp)

with app.app_context():
    init_db()


@app.route('/map/<string:mx_id>')
@login_required
def taxon_map(mx_id):
    with Session() as db:
        taxon = db.query(Taxon).filter_by(mx_id=mx_id).first()
    if not taxon:
        abort(404)
    return render_template('map.html', taxon=taxon)


if __name__ == "__main__":
    from livereload import Server
    server = Server(app.wsgi_app)
    server.watch("templates/*.html")
    server.watch("static/*.js")
    server.serve(port=5000, host="0.0.0.0")

