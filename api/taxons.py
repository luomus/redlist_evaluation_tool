"""Taxon hierarchy and search API endpoints."""
from flask import Blueprint, jsonify, request, current_app
from models import Session, Taxon, Project
from cache import stats_cache
from utils.helpers import project_to_dict
from auth.decorators import login_required

bp = Blueprint('api_taxons', __name__, url_prefix='/api')


@bp.route('/taxons/tree', methods=['GET'])
@login_required
def list_taxons_tree():
    """Return the taxon hierarchy as a lightweight tree without species/projects.

    Used for fast initial page load. Species are fetched on-demand per taxon
    via /api/taxons/<id>/children when the user expands a leaf node.
    """
    try:
        cache_key = "taxons:tree_only"
        cached_result = stats_cache.get(cache_key)
        if cached_result is not None:
            return jsonify(cached_result)

        db = Session()
        roots = (db.query(Taxon)
                 .filter(Taxon.parent_id.is_(None))
                 .order_by(Taxon.sort_order)
                 .all())

        def build(taxon):
            return {
                'id': taxon.id,
                'name': taxon.name,
                'scientific_name': taxon.scientific_name,
                'level': taxon.level,
                'parent_id': taxon.parent_id,
                'is_leaf': taxon.is_leaf,
                'children': [build(c) for c in sorted(taxon.children or [], key=lambda t: t.sort_order)],
            }

        tree = [build(r) for r in roots]
        db.close()

        result = {'taxons': tree}
        stats_cache.set(cache_key, result)
        return jsonify(result)
    except Exception as e:
        current_app.logger.error(f"Failed to list taxons tree: {str(e)}", exc_info=True)
        return jsonify({'success': False, 'error': str(e)}), 500


@bp.route('/taxons/<int:taxon_id>/children', methods=['GET'])
@login_required
def get_taxon_children(taxon_id):
    """Return the projects (species) for a leaf taxon, called when the user expands it.

    For leaf taxons: returns the taxon's projects with full metadata.
    The result is cached so repeated expansions are fast.
    """
    try:
        cache_key = f"taxon_children:{taxon_id}"
        cached_result = stats_cache.get(cache_key)
        if cached_result is not None:
            return jsonify(cached_result)

        db = Session()
        taxon = db.query(Taxon).filter_by(id=taxon_id).first()
        if not taxon:
            db.close()
            return jsonify({'success': False, 'error': 'Taxon not found'}), 404

        result = {
            'id': taxon.id,
            'is_leaf': taxon.is_leaf,
            'projects': [project_to_dict(p) for p in (taxon.projects or [])] if taxon.is_leaf else [],
        }
        db.close()

        stats_cache.set(cache_key, result)
        return jsonify(result)
    except Exception as e:
        current_app.logger.error(f"Failed to get taxon children: {str(e)}", exc_info=True)
        return jsonify({'success': False, 'error': str(e)}), 500


@bp.route('/search', methods=['GET'])
@login_required
def search_species_api():
    """Search for species and taxon groups by name/description across the entire database.

    Query params:
      q  – search term (case-insensitive substring match)

    Returns JSON with:
      speciesMatches – list of matching projects with breadcrumb path
      groupMatches   – list of matching taxon groups with breadcrumb path
    """
    try:
        query = request.args.get('q', '').strip()
        if not query:
            return jsonify({'speciesMatches': [], 'groupMatches': []})

        db = Session()

        # Build an id→taxon lookup for breadcrumb resolution
        all_taxons = {t.id: t for t in db.query(Taxon).all()}

        def build_breadcrumb(taxon_id):
            path = []
            current_id = taxon_id
            while current_id is not None:
                t = all_taxons.get(current_id)
                if t is None:
                    break
                path.insert(0, t.name)
                current_id = t.parent_id
            return path

        # Species / project matches
        projects = (
            db.query(Project)
            .filter(
                (Project.name.ilike(f'%{query}%')) |
                (Project.description.ilike(f'%{query}%'))
            )
            .order_by(Project.name)
            .all()
        )

        species_results = []
        for p in projects:
            breadcrumb = build_breadcrumb(p.taxon_id)
            species_results.append({
                'id': p.id,
                'name': p.name,
                'description': p.description,
                'taxon_id': p.taxon_id,
                'iucn_category': p.iucn_category,
                'mx_id': p.mx_id,
                'breadcrumb': breadcrumb,
            })

        # Taxon group matches
        taxons = (
            db.query(Taxon)
            .filter(
                (Taxon.name.ilike(f'%{query}%')) |
                (Taxon.scientific_name.ilike(f'%{query}%'))
            )
            .order_by(Taxon.name)
            .all()
        )

        group_results = []
        for t in taxons:
            breadcrumb = build_breadcrumb(t.parent_id) if t.parent_id else []
            group_results.append({
                'id': t.id,
                'name': t.name,
                'scientific_name': t.scientific_name,
                'is_leaf': t.is_leaf,
                'breadcrumb': breadcrumb,
            })

        db.close()
        return jsonify({'speciesMatches': species_results, 'groupMatches': group_results})
    except Exception as e:
        current_app.logger.error(f"Search API failed: {str(e)}", exc_info=True)
        return jsonify({'success': False, 'error': str(e)}), 500
