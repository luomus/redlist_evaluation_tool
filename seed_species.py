"""
Standalone species seeding script.

Use this to seed (or re-seed) species into an EXISTING database that already
has taxons loaded – e.g. the remote OpenShift database.

Usage:
    python seed_species.py

The script uses the same DATABASE_URL environment variable as the main app.
It is fully idempotent: if projects already exist, nothing is inserted.

To force a re-seed after clearing the projects table manually:
    psql ... -c "DELETE FROM projects CASCADE;"
    python seed_species.py
"""

from models import Session
from species_loader import load_species_to_db

if __name__ == "__main__":
    print("Seeding species from species_and_groups.tsv ...")
    try:
        load_species_to_db(Session)
        print("Done.")
    except Exception as e:
        print(f"Error during species seeding: {e}")
        import traceback
        traceback.print_exc()
