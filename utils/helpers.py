"""Helper functions for biotools application."""

from time import time
from random import randint
import csv
from models import Taxon

def generate_id():
    return int(time() * 1000) + randint(0, 999)


def find_column_icase(row, column_names):
    """Find a value in a dict by case-insensitive column name match."""
    if not row:
        return None
    for key, value in row.items():
        if key is None or value is None:
            continue
        if key.strip().lower() in [name.lower() for name in column_names]:
            return value
    return None

def guess_delimeter(content):
    # Auto-detect delimiter (comma, semicolon, or tab)
    sample = content[:1024] if len(content) > 1024 else content
    try:
        sniffer = csv.Sniffer()
        return sniffer.sniff(sample).delimiter
    except csv.Error:
        # Fall back to detecting common delimiters
        if ';' in sample:
            return ';'
        elif '\t' in sample:
            return '\t'
        else:
            return ','

def get_taxon_by_name(session, taxon_name):
    """Retrieve a Taxon object by its name."""
    return session.query(Taxon).filter(taxon_name == taxon_name).first()
