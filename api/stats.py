"""Statistics and analytics API endpoint."""
from flask import Blueprint, jsonify, current_app
from sqlalchemy import text, cast, Integer, func
from models import Project, Observation
from data_loaders.database import Session
from cache import stats_cache
from auth.decorators import login_required

bp = Blueprint('api_stats', __name__, url_prefix='/api')


@bp.route('/observations/<int:project_id>/stats', methods=['GET'])
@login_required
def get_dataset_stats(project_id):
    """Calculate project statistics in the database for scalability"""
    try:
        cache_key = f"stats:{project_id}"
        cached_result = stats_cache.get(cache_key)
        if cached_result:
            return jsonify(cached_result)
        
        session = Session()
        
        # Get project info
        project = session.query(Project).filter_by(id=project_id).first()
        if not project:
            session.close()
            return jsonify({"success": False, "error": "Project not found"}), 404
        
        # Get total count
        total = session.query(func.count(Observation.id)).filter_by(project_id=project_id).scalar()
        
        if total == 0:
            session.close()
            return jsonify({"success": False, "error": "Project has no observations"}), 404
        
        # Unique species count
        unique_species = session.query(
            func.count(func.distinct(
                Observation.properties['unit.linkings.taxon.scientificName'].astext
            ))
        ).filter(
            Observation.project_id == project_id,
            Observation.properties['unit.linkings.taxon.scientificName'].astext.isnot(None)
        ).scalar() or 0
        
        # Unique localities count
        unique_localities = session.query(
            func.count(func.distinct(
                Observation.properties['gathering.locality'].astext
            ))
        ).filter(
            Observation.project_id == project_id,
            Observation.properties['gathering.locality'].astext.isnot(None)
        ).scalar() or 0
        
        # Date range
        dates = session.query(
            func.min(Observation.properties['gathering.displayDateTime'].astext),
            func.max(Observation.properties['gathering.displayDateTime'].astext)
        ).filter_by(project_id=project_id).first()
        
        date_range = {
            "earliest": dates[0].split(' ')[0] if dates[0] else None,
            "latest": dates[1].split(' ')[0] if dates[1] else None
        }
        
        # Record basis counts
        record_basis_results = session.query(
            Observation.properties['unit.recordBasis'].astext.label('basis'),
            func.count(Observation.id).label('count')
        ).filter_by(
            project_id=project_id
        ).group_by(
            Observation.properties['unit.recordBasis'].astext
        ).all()
        
        record_basis_counts = {
            (row.basis or 'Unknown'): row.count 
            for row in record_basis_results
        }
        
        # Individual count statistics
        individual_stats_raw = session.query(
            func.min(cast(Observation.properties['unit.interpretations.individualCount'].astext, Integer)),
            func.max(cast(Observation.properties['unit.interpretations.individualCount'].astext, Integer)),
            func.sum(cast(Observation.properties['unit.interpretations.individualCount'].astext, Integer)),
            func.avg(cast(Observation.properties['unit.interpretations.individualCount'].astext, Integer)),
            func.count(Observation.id)
        ).filter(
            Observation.project_id == project_id,
            Observation.properties['unit.interpretations.individualCount'].astext.isnot(None),
            Observation.properties['unit.interpretations.individualCount'].astext.cast(Integer).isnot(None)
        ).first()
        
        individual_count_stats = None
        if individual_stats_raw and individual_stats_raw[4] > 0:
            individual_count_stats = {
                "min": individual_stats_raw[0],
                "max": individual_stats_raw[1],
                "sum": individual_stats_raw[2],
                "average": float(individual_stats_raw[3]) if individual_stats_raw[3] else 0,
                "count": individual_stats_raw[4]
            }
        
        # Top 10 species
        top_species_results = session.query(
            Observation.properties['unit.linkings.taxon.scientificName'].astext.label('species'),
            func.count(Observation.id).label('count')
        ).filter(
            Observation.project_id == project_id,
            Observation.properties['unit.linkings.taxon.scientificName'].astext.isnot(None)
        ).group_by(
            Observation.properties['unit.linkings.taxon.scientificName'].astext
        ).order_by(
            func.count(Observation.id).desc()
        ).limit(10).all()
        
        top_species = [
            {"species": row.species, "count": row.count}
            for row in top_species_results
        ]
        
        # Top 10 observers
        observer_query = """
            SELECT kv.value as observer, COUNT(*) as count
            FROM observations, jsonb_each_text(properties) AS kv(key, value)
            WHERE project_id = :project_id
              AND kv.key LIKE 'gathering.team%'
              AND kv.value IS NOT NULL
            GROUP BY kv.value
            ORDER BY count DESC
            LIMIT 10
        """

        top_observers_results = session.execute(text(observer_query), {'project_id': project_id}).fetchall()
        top_observers = [
            {"observer": row[0], "count": row[1]}
            for row in top_observers_results
        ]

        # Count unique observers
        unique_observers_query = """
            SELECT COUNT(DISTINCT kv.value) FROM observations, jsonb_each_text(properties) AS kv(key, value)
            WHERE project_id = :project_id
              AND kv.key LIKE 'gathering.team%'
              AND kv.value IS NOT NULL
        """
        unique_observers = session.execute(text(unique_observers_query), {'project_id': project_id}).scalar() or 0
        
        # Get latest dataset info
        latest_obs = session.query(Observation).filter_by(project_id=project_id).order_by(Observation.created_at.desc()).first()
        latest_dataset = None
        if latest_obs:
            latest_dataset = {
                'dataset_id': latest_obs.dataset_id,
                'dataset_name': latest_obs.dataset_name,
                'dataset_url': latest_obs.dataset_url,
                'created_at': latest_obs.created_at.isoformat() if latest_obs.created_at else None
            }
        
        # Temporal trends: observations per year
        temporal_trends_query = """
            SELECT 
                EXTRACT(YEAR FROM 
                    TO_DATE(SUBSTRING(properties->>'gathering.displayDateTime', 1, 10), 'YYYY-MM-DD')
                )::INTEGER as year,
                COUNT(*) as count
            FROM observations
            WHERE project_id = :project_id
              AND properties->>'gathering.displayDateTime' IS NOT NULL
              AND properties->>'gathering.displayDateTime' ~ '^\d{4}-\d{2}-\d{2}'
            GROUP BY year
            ORDER BY year ASC
        """
        temporal_results = session.execute(text(temporal_trends_query), {'project_id': project_id}).fetchall()
        
        temporal_trends = []
        if temporal_results:
            for row in temporal_results:
                if row[0] is not None:
                    temporal_trends.append({
                        "year": int(row[0]),
                        "count": int(row[1])
                    })
        
        # Calculate decline percentage based on temporal trends
        decline_percentage = None
        trend_direction = None
        annual_change = 0
        if len(temporal_trends) >= 2:
            mid_point = len(temporal_trends) // 2
            
            first_half_count = sum(t['count'] for t in temporal_trends[:mid_point]) or 1
            second_half_count = sum(t['count'] for t in temporal_trends[mid_point:]) or 1
            
            decline_percentage = round(
                ((second_half_count - first_half_count) / first_half_count) * 100, 
                2
            )
            
            if decline_percentage < -5:
                trend_direction = "declining"
            elif decline_percentage > 5:
                trend_direction = "increasing"
            else:
                trend_direction = "stable"
            
            earliest_year_count = temporal_trends[0]['count']
            latest_year_count = temporal_trends[-1]['count']
            earliest_year = temporal_trends[0]['year']
            latest_year = temporal_trends[-1]['year']
            
            if latest_year > earliest_year:
                annual_change = round(
                    (latest_year_count - earliest_year_count) / (latest_year - earliest_year),
                    2
                )
        
        session.close()
        
        result = {
            "success": True,
            "project_id": project_id,
            "project_name": project.name,
            "project_description": project.description,
            "created_at": project.created_at.isoformat() if project.created_at else None,
            "dataset_id": latest_dataset['dataset_id'] if latest_dataset else None,
            "dataset_name": latest_dataset['dataset_name'] if latest_dataset else None,
            "dataset_url": latest_dataset['dataset_url'] if latest_dataset else None,
            "dataset_created_at": latest_dataset['created_at'] if latest_dataset else None,
            "stats": {
                "totalRecords": total,
                "uniqueSpecies": unique_species,
                "uniqueLocalities": unique_localities,
                "uniqueObservers": unique_observers,
                "dateRange": date_range,
                "recordBasisCounts": record_basis_counts,
                "individualCountStats": individual_count_stats,
                "topSpecies": top_species,
                "topObservers": top_observers,
                "temporalTrends": {
                    "byYear": temporal_trends,
                    "declinePercentage": decline_percentage,
                    "trendDirection": trend_direction,
                    "annualChange": annual_change
                }
            }
        }
        
        stats_cache.set(cache_key, result)
        
        return jsonify(result)
        
    except Exception as e:
        current_app.logger.error(f"Failed to get dataset stats: {str(e)}", exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500
