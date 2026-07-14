"""Species/project management API endpoints."""
from flask import Blueprint, jsonify, request, current_app
from sqlalchemy import func
from models import Project, Observation, ConvexHull, GridCell
from data_loaders.database import Session
from cache import stats_cache
from utils.helpers import project_to_dict
from auth.decorators import login_required

bp = Blueprint('api_species', __name__, url_prefix='/api')


@bp.route('/species', methods=['POST'])
@login_required
def create_species():
    """Create a new species project under a leaf taxon."""
    try:
        data = request.json
        name = (data.get('name') or '').strip()
        description = (data.get('description') or '').strip()
        taxon_id = data.get('taxon_id')

        if not name:
            return jsonify({'success': False, 'error': 'Species name is required'}), 400
        if not taxon_id:
            return jsonify({'success': False, 'error': 'taxon_id is required'}), 400

        db = Session()
        from models import Taxon
        taxon = db.query(Taxon).filter_by(id=taxon_id).first()
        if not taxon:
            db.close()
            return jsonify({'success': False, 'error': 'Taxon not found'}), 404

        project = Project(name=name, description=description, taxon_id=taxon_id)
        db.add(project)
        db.commit()
        result = project_to_dict(project)
        db.close()
        
        stats_cache.delete('taxons:tree_only')
        stats_cache.delete(f'taxon_children:{taxon_id}')
        
        return jsonify({'success': True, 'project': result})
    except Exception as e:
        current_app.logger.error(f"Failed to create species: {str(e)}", exc_info=True)
        return jsonify({'success': False, 'error': str(e)}), 500


@bp.route('/species/<int:project_id>', methods=['GET'])
@login_required
def get_species(project_id):
    """Get a single species project with observation/dataset counts."""
    try:
        db = Session()
        project = db.query(Project).filter_by(id=project_id).first()
        if not project:
            db.close()
            return jsonify({'success': False, 'error': 'Project not found'}), 404

        obs_count = db.query(func.count(Observation.id)).filter_by(project_id=project_id).scalar() or 0
        dataset_count = db.query(func.count(func.distinct(Observation.dataset_id))).filter_by(project_id=project_id).scalar() or 0

        result = project_to_dict(project)
        result['observation_count'] = obs_count
        result['dataset_count'] = dataset_count
        db.close()
        return jsonify(result)
    except Exception as e:
        current_app.logger.error(f"Failed to get species: {str(e)}", exc_info=True)
        return jsonify({'success': False, 'error': str(e)}), 500


@bp.route('/species/<int:project_id>', methods=['PUT', 'PATCH'])
@login_required
def update_species(project_id):
    """Update species project description."""
    try:
        data = request.json
        description = (data.get('description') or '').strip()

        db = Session()
        project = db.query(Project).filter_by(id=project_id).first()
        if not project:
            db.close()
            return jsonify({'success': False, 'error': 'Project not found'}), 404

        taxon_id = project.taxon_id
        project.description = description
        db.commit()
        result = project_to_dict(project)
        db.close()
        stats_cache.delete('taxons:tree_only')
        stats_cache.delete(f'taxon_children:{taxon_id}')
        return jsonify({'success': True, 'project': result})
    except Exception as e:
        current_app.logger.error(f"Failed to update species: {str(e)}", exc_info=True)
        return jsonify({'success': False, 'error': str(e)}), 500


@bp.route('/species/<int:project_id>', methods=['DELETE'])
@login_required
def delete_species(project_id):
    """Delete a species project and all its data."""
    try:
        db = Session()
        project = db.query(Project).filter_by(id=project_id).first()
        if not project:
            db.close()
            return jsonify({'success': False, 'error': 'Project not found'}), 404

        taxon_id = project.taxon_id
        obs_count = db.query(Observation).filter_by(project_id=project_id).count()
        db.query(ConvexHull).filter_by(project_id=project_id).delete()
        db.query(GridCell).filter_by(project_id=project_id).delete(synchronize_session=False)
        db.delete(project)
        db.commit()
        db.close()
        stats_cache.delete(f"stats:{project_id}")
        stats_cache.delete('taxons:tree_only')
        stats_cache.delete(f'taxon_children:{taxon_id}')
        return jsonify({'success': True, 'deleted_observations': obs_count})
    except Exception as e:
        current_app.logger.error(f"Failed to delete species: {str(e)}", exc_info=True)
        return jsonify({'success': False, 'error': str(e)}), 500


@bp.route('/species/<int:project_id>/datasets', methods=['GET'])
@login_required
def list_species_datasets(project_id):
    """List all datasets within a species project."""
    try:
        db = Session()
        results = db.query(
            Observation.dataset_id,
            func.max(Observation.dataset_name).label('dataset_name'),
            func.max(Observation.dataset_url).label('dataset_url'),
            func.max(Observation.created_at).label('created_at'),
            func.count(Observation.id).label('count')
        ).filter_by(
            project_id=project_id
        ).group_by(
            Observation.dataset_id
        ).order_by(
            func.max(Observation.created_at).desc()
        ).all()

        datasets = [{
            'dataset_id': row.dataset_id,
            'dataset_name': row.dataset_name,
            'dataset_url': row.dataset_url,
            'created_at': row.created_at.isoformat() if row.created_at else None,
            'count': row.count
        } for row in results]

        db.close()
        return jsonify({'datasets': datasets, 'project_id': project_id})
    except Exception as e:
        current_app.logger.error(f"Failed to list datasets: {str(e)}", exc_info=True)
        return jsonify({'success': False, 'error': str(e)}), 500


@bp.route('/species/<int:project_id>/datasets/<dataset_id>', methods=['DELETE'])
@login_required
def delete_species_dataset(project_id, dataset_id):
    """Delete a specific dataset from a species project."""
    try:
        db = Session()
        obs_count = db.query(Observation).filter_by(project_id=project_id, dataset_id=dataset_id).delete()
        db.commit()
        db.close()
        stats_cache.delete(f"stats:{project_id}")
        return jsonify({'success': True, 'deleted_observations': obs_count})
    except Exception as e:
        current_app.logger.error(f"Failed to delete dataset: {str(e)}", exc_info=True)
        return jsonify({'success': False, 'error': str(e)}), 500
