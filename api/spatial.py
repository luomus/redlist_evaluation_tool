"""Spatial analysis API endpoints (convex hull, grid)."""
import json
from datetime import datetime
from flask import Blueprint, jsonify, request, current_app
from sqlalchemy import text
from models import Taxon, ConvexHull
from data_loaders.database import Session
from auth.decorators import login_required

bp = Blueprint('api_spatial', __name__, url_prefix='/api')


@bp.route('/observations/<string:mx_id>/convex_hull', methods=['GET'])
def get_convex_hull(mx_id):
    """Get the pre-calculated convex hull for a taxon."""
    try:
        db = Session()
        mode = request.args.get('mode', 'max')
        if mode not in ('max', 'min'):
            db.close()
            return jsonify({"success": False, "error": "Invalid mode"}), 400

        taxon = db.query(Taxon).filter_by(mx_id=mx_id).first()
        if not taxon:
            db.close()
            return jsonify({"success": False, "error": "Taxon not found"}), 404

        hull = db.query(ConvexHull).filter_by(taxon_id=taxon.id, mode=mode).first()
        if not hull:
            db.close()
            return jsonify({
                "success": False,
                "error": "Convex hull not calculated yet. Click 'Re-calculate Hull' to generate it.",
                "mode": mode
            }), 404

        geometry_geojson = None
        if hull.geometry:
            geometry_geojson = json.loads(db.scalar(hull.geometry.ST_AsGeoJSON()))

        db.close()
        return jsonify({
            "success": True,
            "mx_id": mx_id,
            "mode": mode,
            "geometry": geometry_geojson,
            "area_km2": hull.area_km2,
            "calculated_at": hull.calculated_at.isoformat() if hull.calculated_at else None
        })
    except Exception as e:
        current_app.logger.error(f"Failed to get convex hull: {str(e)}", exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500


@bp.route('/observations/<string:mx_id>/convex_hull', methods=['POST'])
@login_required
def calculate_convex_hull(mx_id):
    """Calculate both max and min convex hulls for a taxon in a single SQL pass."""
    try:
        db = Session()
        taxon = db.query(Taxon).filter_by(mx_id=mx_id).first()
        if not taxon:
            db.close()
            return jsonify({"success": False, "error": "Taxon not found"}), 404

        obs_count = db.execute(
            text("SELECT COUNT(*) FROM observations WHERE taxon_id = :tid"),
            {'tid': taxon.id}
        ).scalar()
        if not obs_count:
            db.close()
            return jsonify({"success": False, "error": "Taxon has no observations"}), 404

        combined_query = text("""
            WITH non_excluded AS (
                SELECT geometry AS geom
                FROM observations
                WHERE taxon_id = :taxon_id
                  AND geometry IS NOT NULL
                  AND (excluded IS NULL OR excluded = FALSE)
            ),
            max_collection AS (SELECT ST_Collect(geom) AS gc FROM non_excluded),
            max_hull AS (SELECT ST_ConvexHull(gc) AS hull FROM max_collection WHERE gc IS NOT NULL),
            distribution_centre AS (
                SELECT ST_Centroid(ST_Collect(ST_Centroid(geom))) AS centre FROM non_excluded
            ),
            min_collection AS (
                SELECT ST_Collect(ST_ClosestPoint(n.geom, d.centre)) AS gc
                FROM non_excluded n, distribution_centre d
            ),
            min_hull AS (SELECT ST_ConvexHull(gc) AS hull FROM min_collection WHERE gc IS NOT NULL)
            SELECT
                mx.hull AS max_geom,
                ST_Area(ST_Transform(mx.hull, 3067)) / 1000000.0 AS max_area_km2,
                mn.hull AS min_geom,
                ST_Area(ST_Transform(mn.hull, 3067)) / 1000000.0 AS min_area_km2
            FROM max_hull mx, min_hull mn
        """)

        result = db.execute(combined_query, {'taxon_id': taxon.id}).fetchone()
        if not result or not result[0]:
            db.close()
            return jsonify({
                "success": False,
                "error": "Could not calculate convex hull. Insufficient non-excluded geometries."
            }), 400

        max_geom, max_area = result[0], float(result[1] or 0)
        min_geom, min_area = result[2], float(result[3] or 0)
        now = datetime.utcnow()

        for mode, hull_wkb, area_km2 in [('max', max_geom, max_area), ('min', min_geom, min_area)]:
            existing = db.query(ConvexHull).filter_by(taxon_id=taxon.id, mode=mode).first()
            if existing:
                existing.geometry = hull_wkb
                existing.area_km2 = area_km2
                existing.calculated_at = now
            else:
                db.add(ConvexHull(
                    taxon_id=taxon.id, mode=mode,
                    geometry=hull_wkb, area_km2=area_km2, calculated_at=now
                ))

        db.commit()
        db.close()
        return jsonify({
            "success": True,
            "mx_id": mx_id,
            "calculated_at": now.isoformat(),
            "max": {"area_km2": max_area},
            "min": {"area_km2": min_area}
        })
    except Exception as e:
        current_app.logger.error(f"Failed to calculate convex hull: {str(e)}", exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500


@bp.route('/observations/<string:mx_id>/grid', methods=['GET'])
def get_grid(mx_id):
    """Get stored grid cells for a taxon as GeoJSON FeatureCollection."""
    try:
        db = Session()
        taxon = db.query(Taxon).filter_by(mx_id=mx_id).first()
        if not taxon:
            db.close()
            return jsonify({"success": False, "error": "Taxon not found"}), 404

        rows = db.execute(
            text("SELECT id, ST_AsGeoJSON(geom) as geom_json FROM grid_cells WHERE taxon_id = :taxon_id"),
            {'taxon_id': taxon.id}
        ).fetchall()
        db.close()

        features = [
            {"type": "Feature", "properties": {"_db_id": r.id},
             "geometry": json.loads(r.geom_json) if r.geom_json else None}
            for r in rows
        ]
        return jsonify({"type": "FeatureCollection", "features": features, "mx_id": mx_id, "success": True})
    except Exception as e:
        current_app.logger.error(f"Failed to get grid: {str(e)}", exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500


@bp.route('/observations/<string:mx_id>/grid', methods=['POST'])
@login_required
def calculate_grid(mx_id):
    """Generate 2km AOO grid cells for a taxon from the Finland base grid."""
    db = Session()
    try:
        taxon = db.query(Taxon).filter_by(mx_id=mx_id).first()
        if not taxon:
            db.close()
            return jsonify({"success": False, "error": "Taxon not found"}), 404

        db.execute(text("DELETE FROM grid_cells WHERE taxon_id = :taxon_id"), {'taxon_id': taxon.id})
        db.execute(text("""
            INSERT INTO grid_cells (taxon_id, geom)
            SELECT DISTINCT :taxon_id, bg.geom_4326
            FROM base_grid_cells bg
            JOIN observations o
              ON o.taxon_id = :taxon_id
              AND o.geometry IS NOT NULL
              AND (o.excluded IS NULL OR o.excluded = FALSE)
              AND bg.geom_4326 && o.geometry
              AND ST_Intersects(bg.geom_4326, o.geometry)
        """), {'taxon_id': taxon.id})
        db.commit()

        cell_count = db.execute(
            text("SELECT COUNT(*) FROM grid_cells WHERE taxon_id = :taxon_id"),
            {'taxon_id': taxon.id}
        ).scalar()
        db.close()
        return jsonify({"success": True, "mx_id": mx_id, "message": "Grid generated", "cell_count": cell_count})
    except Exception as e:
        db.rollback()
        db.close()
        current_app.logger.error(f"Failed to calculate grid: {str(e)}", exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500
