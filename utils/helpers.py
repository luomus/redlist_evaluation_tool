"""Helper functions for biotools application."""

from time import time
from random import randint


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

