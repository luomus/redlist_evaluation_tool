"""
Load species (projects) from species_and_groups.tsv into the database.

TSV columns:
    Tunniste    – FinBIF MX-identifier (e.g. MX.5)
    Laji        – Finnish name + scientific name (used as project name)
    Luokka 2019 – IUCN red-list category (e.g. "LC – Elinvoimaiset")
    Eliöryhmä   – Taxon group label, format "FinnishName, ScientificName"
                  or just "FinnishName".  Must match a leaf taxon in the DB.

Behaviour:
  - Idempotent: if any projects already exist, loading is skipped.
  - Duplicate guard: if a project with the same name already exists under
    the same taxon_id, the row is skipped (logged in the summary).
  - Non-leaf / unknown group: row is skipped and listed in the summary.
"""

import csv
import os

SPECIES_TSV = os.path.join(os.path.dirname(__file__), 'static/resources/species_and_groups.tsv')


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

def load_species_to_db(session_factory, filepath=None):
    """Read TSV and insert species (projects) into the database.

    Called once from models.init_db() after load_taxons_to_db().
    """
    from sqlalchemy import text as sa_text

    filepath = filepath or SPECIES_TSV

    session = session_factory()
    try:
        # Idempotency guard – skip entirely if any projects already exist
        existing = session.execute(sa_text("SELECT COUNT(*) FROM projects")).scalar()
        if existing and int(existing) > 0:
            print(f"Species already loaded ({existing} projects), skipping.")
            return

        # Build lookup: normalised_name → taxon row  (for all taxons)
        # We match species group by the Finnish name portion (before the comma)
        # and fall back to scientific name if needed.
        leaf_taxons = session.execute(
            sa_text("SELECT id, name, scientific_name FROM taxons WHERE is_leaf = TRUE")
        ).mappings().all()

        # Primary: Finnish name → id   (lower-cased)
        by_finnish = {}
        # Secondary: scientific name → id  (lower-cased)
        by_scientific = {}
        for t in leaf_taxons:
            if t['name']:
                by_finnish[t['name'].strip().lower()] = t['id']
            if t['scientific_name']:
                by_scientific[t['scientific_name'].strip().lower()] = t['id']

        # Also build a lookup that includes ALL taxons (non-leaf) so we can
        # warn when a group exists but is not a leaf.
        all_taxons = session.execute(
            sa_text("SELECT id, name, scientific_name, is_leaf FROM taxons")
        ).mappings().all()
        all_by_finnish = {}
        for t in all_taxons:
            if t['name']:
                all_by_finnish[t['name'].strip().lower()] = dict(t)

        # Parse TSV
        rows = _parse_tsv(filepath)

        to_insert = []
        skipped_duplicate = []
        skipped_no_match = []
        skipped_not_leaf = []

        # Track (name_lower, taxon_id) combos within this batch to catch
        # duplicates even when the DB is freshly empty.
        seen_in_batch = set()

        # Pre-build a set of existing (name, taxon_id) pairs for the duplicate check
        # (only relevant if the guard above didn't fire, i.e. DB is empty now)
        existing_pairs = set()  # will stay empty on first run

        for row in rows:
            mx_id = row.get('mx_id', '').strip()
            name = row.get('name', '').strip()
            iucn_category = row.get('iucn_category', '').strip()
            group_raw = row.get('group', '').strip()

            if not name:
                continue

            # Resolve taxon_id from group label
            taxon_id = _resolve_taxon_id(
                group_raw, by_finnish, by_scientific, all_by_finnish,
                name, skipped_no_match, skipped_not_leaf
            )
            if taxon_id is None:
                continue  # already appended to skipped list

            # Duplicate guard (in-batch)
            key = (name.lower(), taxon_id)
            if key in seen_in_batch or key in existing_pairs:
                skipped_duplicate.append(f"{name} [{group_raw}]")
                continue
            seen_in_batch.add(key)

            to_insert.append({
                'name': name,
                'iucn_category': iucn_category or None,
                'mx_id': mx_id or None,
                'taxon_id': taxon_id,
            })

        # Bulk insert
        if to_insert:
            session.execute(
                sa_text("""
                    INSERT INTO projects (name, iucn_category, mx_id, taxon_id)
                    VALUES (:name, :iucn_category, :mx_id, :taxon_id)
                """),
                to_insert,
            )
            session.commit()

        # Summary
        print(f"\nSpecies loader summary:")
        print(f"  Inserted  : {len(to_insert)}")
        print(f"  Skipped (duplicate)  : {len(skipped_duplicate)}")
        print(f"  Skipped (group not found / not a leaf): "
              f"{len(skipped_no_match) + len(skipped_not_leaf)}")

        if skipped_not_leaf:
            print("\n  WARNING – group exists but is NOT a leaf taxon (species not added):")
            for s in skipped_not_leaf:
                print(f"    • {s}")

        if skipped_no_match:
            print("\n  WARNING – group not found in taxon table (species not added):")
            for s in skipped_no_match:
                print(f"    • {s}")

        if skipped_duplicate:
            print("\n  INFO – duplicates skipped:")
            for s in skipped_duplicate:
                print(f"    • {s}")

        print()

    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _parse_tsv(filepath):
    """Return a list of dicts with keys: mx_id, name, iucn_category, group."""
    rows = []
    with open(filepath, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f, delimiter='\t')
        for raw in reader:
            rows.append({
                'mx_id': raw.get('Tunniste', ''),
                'name': raw.get('Laji', ''),
                'iucn_category': raw.get('Luokka 2019', ''),
                'group': raw.get('Eliöryhmä', ''),
            })
    return rows


def _resolve_taxon_id(group_raw, by_finnish, by_scientific,
                       all_by_finnish, species_name,
                       skipped_no_match, skipped_not_leaf):
    """Look up the leaf taxon id for a group label.

    group_raw format examples:
        "Kolmisukahäntäiset, Thysanura"
        "Päiväperhoset"

    Returns the taxon id (int) or None if not resolved.
    Side-effects: appends to skipped_no_match or skipped_not_leaf.
    """
    if not group_raw:
        skipped_no_match.append(f"{species_name} [empty group]")
        return None

    # Split "FinnishName, ScientificName" on the first comma only
    parts = group_raw.split(',', 1)
    finnish_key = parts[0].strip().lower()
    sci_key = parts[1].strip().lower() if len(parts) > 1 else None

    # 1. Try leaf taxons by Finnish name
    if finnish_key in by_finnish:
        return by_finnish[finnish_key]

    # 2. Try leaf taxons by scientific name
    if sci_key and sci_key in by_scientific:
        return by_scientific[sci_key]

    # 3. Check if it exists as a non-leaf (warn differently)
    if finnish_key in all_by_finnish:
        t = all_by_finnish[finnish_key]
        if not t['is_leaf']:
            skipped_not_leaf.append(
                f"{species_name} → group '{group_raw}' found but is NOT a leaf taxon"
            )
            return None

    skipped_no_match.append(
        f"{species_name} → group '{group_raw}' not found in taxons table"
    )
    return None
