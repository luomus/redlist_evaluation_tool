from flask import Flask, render_template, abort
from data_loaders.database import init_db, Session
from config import CARTO_BASEMAP_API_KEY, DEBUG, USE_AUTHENTICATION, get_flask_config
from auth.decorators import login_required
from proxy.mml import bp as proxy_mml_bp
from proxy.laji import bp as proxy_laji_bp
from api.observations import bp as api_observations_bp
from api.spatial import bp as api_spatial_bp
from utils.taxon_service import get_or_create_taxon
from flask import request, session, redirect, url_for
from auth.token import extract_token, check_user

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

    # check_user(request.args.get('iucn_user_id'), session.get('lajiauth_user_id')) TODO: uncomment when using production database

    with Session() as db:
        taxon = get_or_create_taxon(db, mx_id)
    if not taxon:
        print(f"Taxon with mx_id={mx_id} not found")
        abort(404)
    return render_template('map.html', taxon=taxon, carto_basemap_api_key=CARTO_BASEMAP_API_KEY, use_authentication=USE_AUTHENTICATION)

_frontpage_cache = None

@app.route('/')
def frontpage():
    token = request.args.get('token')

    if not token:
        raise ValueError("No token provided")
    
    claims = extract_token(token)

    session['iucn_user_id'] = claims['user']
    session.modified = True

    mx_id = claims['taxon']

    return redirect(url_for('taxon_map', mx_id=mx_id))


if __name__ == "__main__":
    from livereload import Server
    server = Server(app.wsgi_app)
    server.watch("templates/*.html")
    server.watch("static/*.js")
    server.serve(port=5000, host="0.0.0.0")

