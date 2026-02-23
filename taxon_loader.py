"""
Load the static taxon hierarchy from hierarchy.json into the database.

The JSON file contains a nested tree structure:
  [
    {
      "name": "Finnish name",
      "scientific_name": "Scientific name" or null,
      "children": [ ... ]
    },
    ...
  ]

The hierarchy is read-only once loaded. This module is called during
database initialization and will skip loading if taxons already exist.
"""

import json
import os


HIERARCHY_FILE = os.path.join(os.path.dirname(__file__), 'static/resources/hierarchy.json')


def parse_hierarchy(filepath=None):
    """Load hierarchy.json and return the list of root nodes.

    Each node: {
        'name': str,           # Finnish name
        'scientific_name': str or None,
        'children': [node, ...],
    }
    """
    filepath = filepath or HIERARCHY_FILE

    with open(filepath, 'r', encoding='utf-8') as f:
        return json.load(f)


def load_taxons_to_db(session_factory, filepath=None):
    """Insert parsed hierarchy into the taxons table.

    - Skips if taxons already exist.
    - Marks nodes without children as is_leaf=True.
    """
    from sqlalchemy import text as sa_text

    session = session_factory()
    try:
        count = session.execute(sa_text("SELECT COUNT(*) FROM taxons")).scalar()
        if count and int(count) > 0:
            print(f"Taxon hierarchy already loaded ({count} taxons), skipping.")
            return

        roots = parse_hierarchy(filepath)
        if not roots:
            print("Warning: No taxon hierarchy found in hierarchy.json")
            return

        counter = [0]  # mutable counter for sort_order
        inserted = _insert_nodes(session, roots, parent_id=None, level=1, counter=counter)
        session.commit()
        print(f"Taxon hierarchy loaded: {inserted} taxons inserted from hierarchy.json")
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def _insert_nodes(session, nodes, parent_id, level, counter):
    """Recursively insert nodes and return total count."""
    from sqlalchemy import text as sa_text

    total = 0
    for node in nodes:
        is_leaf = len(node['children']) == 0
        sort_order = counter[0]
        counter[0] += 1
        result = session.execute(
            sa_text("""
                INSERT INTO taxons (name, scientific_name, level, parent_id, is_leaf, sort_order)
                VALUES (:name, :sci, :level, :parent_id, :is_leaf, :sort_order)
                RETURNING id
            """),
            {
                'name': node['name'],
                'sci': node['scientific_name'],
                'level': level,
                'parent_id': parent_id,
                'is_leaf': is_leaf,
                'sort_order': sort_order,
            }
        )
        taxon_id = result.scalar()
        total += 1

        if node['children']:
            total += _insert_nodes(session, node['children'], parent_id=taxon_id, level=level + 1, counter=counter)

    return total
