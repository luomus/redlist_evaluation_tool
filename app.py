import logging

from flask import Flask, render_template, abort
from data_loaders.database import init_db, Session
from config import CARTO_BASEMAP_API_KEY, DEBUG, LOGGING_LEVEL, USE_AUTHENTICATION, IUCN_EDITOR_URL, get_flask_config
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
app.logger.setLevel(getattr(logging, LOGGING_LEVEL, logging.INFO))
app.logger.info(f'Application started with USE_AUTHENTICATION={USE_AUTHENTICATION}')

if USE_AUTHENTICATION:
    from auth.routes import auth_bp
    app.register_blueprint(auth_bp)

app.register_blueprint(proxy_mml_bp)
app.register_blueprint(proxy_laji_bp)
app.register_blueprint(api_observations_bp)
app.register_blueprint(api_spatial_bp)

def redirect_with_message(message):
    """Show an error message for a few seconds before redirecting to the IUCN editor."""
    return render_template('redirect_message.html', message=message, redirect_url=IUCN_EDITOR_URL)


@app.route('/map/<string:mx_id>')
@login_required
def taxon_map(mx_id):
    app.logger.debug(f'taxon_map called with mx_id={mx_id}')

    try:
        check_user(session.get('iucn_user_id'), session.get('lajiauth_user_id'))
    except PermissionError as e:
        app.logger.warning(f'taxon_map: {e}')
        return redirect_with_message('Sinulla ei ole oikeuksia tähän lajiin.')

    if not session.get('allowed_mx_ids', {}).get(mx_id):
        app.logger.warning(f'taxon_map: mx_id={mx_id} not authorized by token (allowed={list(session.get("allowed_mx_ids", {}).keys())})')
        return redirect_with_message('Sinulla ei ole oikeuksia tähän lajiin.')

    with Session() as db:
        taxon = get_or_create_taxon(db, mx_id)
    if not taxon:
        app.logger.debug(f'Taxon with mx_id={mx_id} not found')
        return redirect_with_message('Lajia ei löytynyt.')
    return render_template('map.html', taxon=taxon, carto_basemap_api_key=CARTO_BASEMAP_API_KEY, use_authentication=USE_AUTHENTICATION)

@app.route('/')
def frontpage():
    token = request.args.get('token')

    if not token:
        app.logger.warning('frontpage: no token provided, redirecting to IUCN editor')
        return redirect_with_message('Tokenia ei löytynyt. Sinun tulee kirjautua työkaluun IUCN-editorin kautta.')

    try:
        claims = extract_token(token)
    except ValueError as e:
        app.logger.warning(f'frontpage: invalid token ({e}), redirecting to IUCN editor')
        return redirect_with_message('Virheellinen tai vanhentunut token.')

    app.logger.debug(f'frontpage: token claims resolved to user={claims["user"]}, taxon={claims["taxon"]}')

    allowed_mx_ids = session.get('allowed_mx_ids', {})

    # Grants belong to the user they were issued to.
    if session.get('iucn_user_id') != claims['user']:
        app.logger.debug(f'frontpage: iucn_user_id changed from {session.get("iucn_user_id")} to {claims["user"]}, clearing allowed_mx_ids')
        allowed_mx_ids = {}

    session['iucn_user_id'] = claims['user']

    allowed_mx_ids[claims['taxon']] = True
    session['allowed_mx_ids'] = allowed_mx_ids
    session.modified = True

    mx_id = claims['taxon']

    return redirect(url_for('taxon_map', mx_id=mx_id))


if __name__ == "__main__":
    from livereload import Server
    if not DEBUG:
        logging.getLogger('tornado.access').setLevel(logging.WARNING)
    server = Server(app.wsgi_app)
    server.watch("templates/*.html")
    server.watch("static/*.js")
    server.serve(port=5000, host="0.0.0.0")

