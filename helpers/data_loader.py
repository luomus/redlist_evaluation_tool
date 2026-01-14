"""
Data loading utilities for reading occurrence data files.
"""

import csv
from collections import defaultdict


def load_occurrences(input_file):
    """
    Load occurrence data from a tab-separated file.
    
    The file format has 3 header rows:
    1. DwC field names (used as column names)
    2. Finnish names (skipped)
    3. English names (skipped)
    
    Args:
        input_file (str): Path to the occurrences.txt file
    
    Returns:
        list: List of dictionaries, each containing 'gridCellYKJ' and 'scientificName'
    """
    records = []
    
    try:
        with open(input_file, 'r', encoding='utf-8') as f:
            # Read first line (DwC field names) to get column names
            first_line = f.readline().strip()
            fieldnames = first_line.split('\t')
            
            # Skip the next 2 header rows (Finnish and English)
            f.readline()  # Skip Finnish header
            f.readline()  # Skip English header
            
            # Now create reader with the fieldnames we extracted
            reader = csv.DictReader(f, fieldnames=fieldnames, delimiter='\t')
            
            # Process each row
            for row in reader:
                grid_cell = row.get('gridCellYKJ', '').strip()
                scientific_name = row.get('scientificName', '').strip()
                
                # Skip rows without grid cell or scientific name
                if grid_cell and scientific_name:
                    records.append({
                        'gridCellYKJ': grid_cell,
                        'scientificName': scientific_name
                    })
    
    except FileNotFoundError:
        raise FileNotFoundError(f"Input file not found: {input_file}")
    except Exception as e:
        raise RuntimeError(f"Error reading input file {input_file}: {e}")
    
    return records


def group_by_grid_cell(records, resolution_km):
    """
    Group occurrence records by grid cell at the specified resolution.
    
    Args:
        records (list): List of record dictionaries with 'gridCellYKJ' and 'scientificName'
        resolution_km (int): Target resolution in kilometers (1, 10, or 100)
    
    Returns:
        dict: Dictionary mapping grid cells to lists of species names (with duplicates)
              Example: {"67:34": ["Species A", "Species B", "Species A", ...], ...}
    """
    from helpers.grid_utils import convert_to_resolution
    
    area_records = defaultdict(list)
    
    for record in records:
        grid_cell = record['gridCellYKJ']
        scientific_name = record['scientificName']
        
        # Convert to target resolution
        converted_grid_cell = convert_to_resolution(grid_cell, resolution_km)
        if converted_grid_cell is None:
            continue
        
        # Add species record to this area
        area_records[converted_grid_cell].append(scientific_name)
    
    return dict(area_records)

