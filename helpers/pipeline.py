"""
Pipeline orchestrator for processing occurrence data and generating maps.
"""

import json
import os
from pathlib import Path

from helpers.data_loader import load_occurrences, group_by_grid_cell
from helpers.analysis_methods import get_method
from helpers.color_utils import add_colors_to_values
from helpers.simplemap import create_finland_map


def extract_basename(input_file):
    """
    Extract basename from input file path.
    
    Args:
        input_file (str): Path to input file, e.g., "secret/HBF.114297-kaskaat/occurrences.txt"
    
    Returns:
        str: Basename extracted from parent folder, e.g., "HBF.114297-kaskaat"
    """
    path = Path(input_file)
    basename = path.parent.name
    return basename


def get_output_paths(basename, method, resolution_km, output_base="results"):
    """
    Generate output file paths for JSON data and map image.
    
    Args:
        basename (str): Basename (e.g., "HBF.114297-kaskaat")
        method (str): Analysis method name (e.g., "chao1")
        resolution_km (int): Resolution in kilometers (e.g., 100)
        output_base (str): Base output directory (default: "results")
    
    Returns:
        tuple: (output_dir, json_path, map_path)
    """
    output_dir = Path(output_base) / basename
    json_file = output_dir / f"{basename}_{method}_{resolution_km}km.json"
    map_file = output_dir / f"{basename}_{method}_{resolution_km}km_map.png"
    return output_dir, json_file, map_file


def process_data(input_file, method, resolution_km, output_base="results"):
    """
    Process occurrence data and generate both JSON data file and map image.
    
    This function:
    1. Loads occurrence data from the input file
    2. Groups records by grid cells at the specified resolution
    3. Calculates values using the specified analysis method
    4. Adds color mapping to the values
    5. Saves JSON data file
    6. Generates map image
    
    Args:
        input_file (str): Path to input occurrences.txt file
        method (str): Analysis method ("speciescount", "chao1", or "accumulation_curve")
        resolution_km (int): Grid resolution in kilometers (1, 10, or 100)
        output_base (str): Base directory for output files (default: "results")
    
    Returns:
        tuple: (json_path, map_path) - Paths to generated files
    
    Raises:
        FileNotFoundError: If input file doesn't exist
        ValueError: If method or resolution is invalid
    """
    # Validate resolution
    valid_resolutions = [1, 10, 50, 100]
    if resolution_km not in valid_resolutions:
        raise ValueError(f"Invalid resolution: {resolution_km}km. Must be one of: {', '.join(map(str, valid_resolutions))}")
    
    # Extract basename from input file path
    basename = extract_basename(input_file)
    
    # Get output paths
    output_dir, json_path, map_path = get_output_paths(basename, method, resolution_km, output_base)
    
    # Ensure output directory exists
    output_dir.mkdir(parents=True, exist_ok=True)
    
    print(f"Processing: {basename}")
    print(f"  Method: {method}")
    print(f"  Resolution: {resolution_km}km")
    print(f"  Input: {input_file}")
    
    # Step 1: Load occurrence data
    print("  Loading occurrence data...")
    records = load_occurrences(input_file)
    print(f"  Loaded {len(records)} occurrence records")
    
    # Step 2: Group by grid cells at target resolution
    print(f"  Grouping by {resolution_km}km grid cells...")
    area_records = group_by_grid_cell(records, resolution_km)
    print(f"  Found {len(area_records)} grid cells with data")
    
    if not area_records:
        raise ValueError("No valid grid cells found after grouping.")
    
    # Step 3: Calculate values using the specified method
    print(f"  Calculating {method}...")
    analysis_func = get_method(method)
    values_dict = analysis_func(area_records)
    
    if not values_dict:
        raise ValueError(f"No values calculated for method {method}.")
    
    # Step 4: Add color mapping
    print("  Adding color mapping...")
    data_with_colors = add_colors_to_values(values_dict)
    
    # Step 5: Save JSON data file
    print(f"  Saving JSON data to {json_path}...")
    with open(json_path, 'w', encoding='utf-8') as f:
        json.dump(data_with_colors, f, indent=2, ensure_ascii=False)
    
    # Step 6: Generate map
    print(f"  Generating map to {map_path}...")
    success = create_finland_map(data_with_colors, str(map_path), resolution_km=resolution_km)
    
    if not success:
        raise RuntimeError(f"Failed to generate map: {map_path}")
    
    print(f"  ✓ Complete: {json_path}")
    print(f"  ✓ Complete: {map_path}")
    
    return str(json_path), str(map_path)

