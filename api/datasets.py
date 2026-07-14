"""Datasets listing API endpoint."""
from flask import Blueprint, jsonify, current_app
from sqlalchemy import func
from models import Observation
from data_loaders.database import Session
from auth.decorators import login_required

bp = Blueprint('api_datasets', __name__, url_prefix='/api')


@bp.route('/datasets', methods=['GET'])
@login_required
def list_datasets():
    """List all available datasets"""
    try:
        session = Session()
        
        results = session.query(
            Observation.dataset_id,
            func.max(Observation.dataset_name).label('dataset_name'),
            func.max(Observation.created_at).label('created_at'),
            func.count(Observation.id).label('count')
        ).group_by(Observation.dataset_id).order_by(
            func.max(Observation.created_at).desc()
        ).all()
        
        datasets = []
        for dataset_id, dataset_name, created_at, count in results:
            datasets.append({
                "id": dataset_id,
                "name": dataset_name,
                "created_at": created_at.isoformat() if created_at else None,
                "count": count
            })
        
        session.close()
        return jsonify({"datasets": datasets})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500
