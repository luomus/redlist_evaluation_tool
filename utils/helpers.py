"""
Helper functions for redlisttools application.
Includes ID generation, data serialization, and other utilities.
"""

from time import time
from random import randint


def generate_id():
    return int(time() * 1000) + randint(0, 999)


def project_to_dict(project):
    return {
        'id': project.id,
        'name': project.name,
        'description': project.description,
        'taxon_id': project.taxon_id,
        'iucn_category': project.iucn_category,
        'mx_id': project.mx_id,
        'created_at': project.created_at.isoformat() if project.created_at else None,
        'updated_at': project.updated_at.isoformat() if project.updated_at else None,
    }


def find_column_icase(row, column_names):
    """
    Find a value in a dictionary by case-insensitive column name matching.
    Useful for parsing CSV data where column names may vary in case.
    """
    if not row:
        return None
    
    for key, value in row.items():
        if key is None or value is None:
            continue
        key_lower = key.strip().lower()
        if key_lower in [name.lower() for name in column_names]:
            return value
    
    return None
