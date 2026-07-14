"""Spatial analysis API endpoints (convex hull, grid)."""
import json
from datetime import datetime
from flask import Blueprint, jsonify, request, current_app
from sqlalchemy import text
from models import Observation, ConvexHull
from data_loaders.database import Session
from auth.decorators import login_required

bp = Blueprint('api_spatial', __name__, url_prefix='/api')


@bp.route('/observations/<int:project_id>/convex_hull', methods=['GET'])
@login_required
def get_convex_hull(project_id):
    """Get the pre-calculated convex hull for a project."""
    try:
        session = Session()
        mode = request.args.get('mode', 'max')
        if mode not in ('max', 'min'):
            session.close()
            return jsonify({"success": False, "error": "Invalid mode"}), 400
        
        convex_hull = session.query(ConvexHull).filter_by(project_id=project_id, mode=mode).first()
        
        if not convex_hull:
            session.close()
            return jsonify({
                "success": False, 
                "error": "Convex hull not calculated yet. Click 'Re-calculate Hull' to generate it.",
                "mode": mode
            }), 404
        
        # Convert geometry to GeoJSON
        geometry_geojson = None
        if convex_hull.geometry:
            geometry_geojson = json.loads(session.scalar(convex_hull.geometry.ST_AsGeoJSON()))
        
        session.close()
        
        return jsonify({
            "success": True,
            "project_id": project_id,
            "mode": mode,
            "geometry": geometry_geojson,
            "area_km2": convex_hull.area_km2,
            "calculated_at": convex_hull.calculated_at.isoformat() if convex_hull.calculated_at else None
        })
        
    except Exception as e:
        current_app.logger.error(f"Failed to get convex hull: {str(e)}", exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500


@bp.route('/observations/<int:project_id>/convex_hull', methods=['POST'])
@login_required
def calculate_convex_hull(project_id):
    """Calculate both max and min convex hulls for a project in a single SQL pass."""
    try:
        session = Session()

        # Check if project exists
        project_count = session.query(Observation).filter_by(project_id=project_id).count()
        if project_count == 0:
            session.close()
            return jsonify({"success": False, "error": "Project not found or has no observations"}), 404

        combined_query = text("""
            WITH non_excluded AS (
                SELECT geometry AS geom
                FROM observations
                WHERE project_id = :project_id
                  AND geometry IS NOT NULL
                  AND (excluded IS NULL OR excluded = FALSE)
            ),

            max_collection AS (
                SELECT ST_Collect(geom) AS gc FROM non_excluded
            ),
            max_hull AS (
                SELECT ST_ConvexHull(gc) AS hull FROM max_collection WHERE gc IS NOT NULL
            ),

            distribution_centre AS (
                SELECT ST_Centroid(ST_Collect(ST_Centroid(geom))) AS centre FROM non_excluded
            ),
            min_collection AS (
                SELECT ST_Collect(ST_ClosestPoint(n.geom, d.centre)) AS gc
                FROM non_excluded n, distribution_centre d
            ),
            min_hull AS (
                SELECT ST_ConvexHull(gc) AS hull FROM min_collection WHERE gc IS NOT NULL
            )

            SELECT
                mx.hull AS max_geom,
                ST_Area(ST_Transform(mx.hull, 3067)) / 1000000.0 AS max_area_km2,
                mn.hull AS min_geom,
                ST_Area(ST_Transform(mn.hull, 3067)) / 1000000.0 AS min_area_km2
            FROM max_hull mx, min_hull mn
        """)

        result = session.execute(combined_query, {'project_id': project_id}).fetchone()

        if not result or not result[0]:
            session.close()
            return jsonify({
                "success": False,
                "error": "Could not calculate convex hull. Project may have insufficient non-excluded geometries."
            }), 400

        max_geom, max_area, min_geom, min_area = result[0], float(result[1] or 0), result[2], float(result[3] or 0)
        now = datetime.utcnow()

        # Upsert both mode records
        for mode, hull_wkb, area_km2 in [('max', max_geom, max_area), ('min', min_geom, min_area)]:
            existing = session.query(ConvexHull).filter_by(project_id=project_id, mode=mode).first()
            if existing:
                existing.geometry = hull_wkb
                existing.area_km2 = area_km2
                existing.calculated_at = now
            else:
                session.add(ConvexHull(
                    project_id=project_id,
                    mode=mode,
                    geometry=hull_wkb,
                    area_km2=area_km2,
                    calculated_at=now
                ))

        session.commit()
        session.close()

        return jsonify({
            "success": True,
            "project_id": project_id,
            "calculated_at": now.isoformat(),
            "max": {"area_km2": max_area},
            "min": {"area_km2": min_area}
        })

    except Exception as e:
        current_app.logger.error(f"Failed to calculate convex hull: {str(e)}", exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500


@bp.route('/observations/<int:project_id>/grid', methods=['GET'])
@login_required
def get_grid(project_id):
    """Get the stored grid cells for a project as a GeoJSON FeatureCollection"""
    try:
        session = Session()
        rows = session.execute(text("SELECT id, ST_AsGeoJSON(geom) as geom_json FROM grid_cells WHERE project_id = :project_id"), {'project_id': project_id}).fetchall()
        features = []
        for r in rows:
            features.append({
                "type": "Feature",
                "properties": {"_db_id": r.id},
                "geometry": json.loads(r.geom_json) if r.geom_json else None
            })
        session.close()
        return jsonify({"type": "FeatureCollection", "features": features, "project_id": project_id, "success": True})
    except Exception as e:
        current_app.logger.error(f"Failed to get grid: {str(e)}", exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500


@bp.route('/observations/<int:project_id>/grid', methods=['POST'])
@login_required
def calculate_grid(project_id):
    """Generate grid for project by selecting base grid cells that intersect observations."""

    session = Session()
    
    try:
        session.execute(text("DELETE FROM grid_cells WHERE project_id = :project_id"), {'project_id': project_id})

        generation_sql = text("""
            INSERT INTO grid_cells (project_id, geom)
            SELECT DISTINCT :project_id, bg.geom_4326
            FROM base_grid_cells bg
            JOIN observations o
              ON o.project_id = :project_id
              AND o.geometry IS NOT NULL
              AND (o.excluded IS NULL OR o.excluded = FALSE)
              AND bg.geom_4326 && o.geometry
              AND ST_Intersects(bg.geom_4326, o.geometry)
        """)
        session.execute(generation_sql, {'project_id': project_id})

        session.commit()
        
        cell_count = session.execute(text("SELECT COUNT(*) FROM grid_cells WHERE project_id = :project_id"), {'project_id': project_id}).scalar()
        
        session.close()
        return jsonify({"success": True, "project_id": project_id, "message": "Grid generated", "cell_count": cell_count})
    except Exception as e:
        session.rollback()
        session.close()
        current_app.logger.error(f"Failed to calculate grid: {str(e)}", exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500
