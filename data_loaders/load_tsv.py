"""Load taxons from species_and_groups.tsv into the taxons table."""
import csv
import os
from sqlalchemy import text

TSV_PATH = os.path.join(os.path.dirname(__file__), '..', 'static', 'resources', 'species_and_groups.tsv')


def load_taxons_from_tsv(session_factory, filepath=None):
    """Read species_and_groups.tsv and insert taxons. Idempotent (skips if already loaded)."""
    filepath = filepath or TSV_PATH
    session = session_factory()
    try:
        existing = session.execute(text("SELECT COUNT(*) FROM taxons")).scalar()
        if existing and int(existing) > 0:
            print(f"Taxons already loaded ({existing} rows), skipping.")
            return

        rows = _parse_tsv(filepath)
        inserted = 0
        skipped = 0
        for row in rows:
            mx_id = row.get('mx_id', '').strip()
            if not mx_id:
                skipped += 1
                continue
            session.execute(
                text("""
                    INSERT INTO taxons (mx_id, name, category, elio_ryhma)
                    VALUES (:mx_id, :name, :category, :elio_ryhma)
                    ON CONFLICT (mx_id) DO NOTHING
                """),
                {
                    'mx_id': mx_id,
                    'name': row.get('name', '').strip(),
                    'category': row.get('category', '').strip(),
                    'elio_ryhma': row.get('elio_ryhma', '').strip(),
                }
            )
            inserted += 1

        session.commit()
        print(f"Taxons loaded: {inserted} inserted, {skipped} skipped.")
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def _parse_tsv(filepath):
    rows = []
    with open(filepath, newline='', encoding='utf-8') as f:
        reader = csv.DictReader(f, delimiter='\t')
        for row in reader:
            rows.append({
                'mx_id': row.get('Tunniste', ''),
                'name': row.get('Laji', ''),
                'category': row.get('Luokka 2019', ''),
                'elio_ryhma': row.get('Eliöryhmä', ''),
            })
    return rows
