"""
This module creates a simple matplotlib map of Finland with data overlays.
It overlays colored squares representing data points on a grid system.

The squares_data dictionary contains grid coordinates in the format "northing:easting".
Each value is a dictionary with "color" (hex color code) and "value" (numeric value).
Example: {"67:34": {"color": "#ff0000", "value": 0.85}}

The grid size is determined by the number of digits in each coordinate:
- 2 digits (e.g., "67:34") = 100km x 100km squares. Multiply by 100000 to get SW coordinate.
- 3 digits (e.g., "668:338") = 10km x 10km squares. Multiply by 10000 to get SW coordinate.
- 4 digits (e.g., "6789:3458") = 1km x 1km squares. Multiply by 1000 to get SW coordinate.

Each square is rendered as a rectangle with the appropriate size and specified color.
"""

import json
import os
import matplotlib.pyplot as plt
from matplotlib.patches import Rectangle, Patch


def create_finland_map(squares_data, output_file, borders_file=None, figsize=(12, 16), dpi=150, resolution_km=None):
    """
    Create a map of Finland with colored squares overlaid on a grid system.
    
    Args:
        squares_data (dict): Dictionary with grid coordinates as keys (format "northing:easting")
                           and dictionaries as values containing "color" (hex color code) and "value" (numeric).
                           Example: {"67:34": {"color": "#ff0000", "value": 0.85}}
                           Grid size is determined by digit count (or resolution_km if provided):
                           - 2 digits (e.g., "67:34") = 100km squares
                           - 3 digits (e.g., "668:338") = 10km squares (or 50km if resolution_km=50)
                           - 4 digits (e.g., "6789:3458") = 1km squares
        output_file (str): Path to the output PNG file
        borders_file (str, optional): Path to the Finland borders GeoJSON file.
                                     Defaults to "finland_borders.geojson" in the same directory
                                     as this module.
        figsize (tuple, optional): Figure size in inches. Defaults to (12, 16).
        dpi (int, optional): Resolution in dots per inch. Defaults to 150.
        resolution_km (int, optional): Grid resolution in kilometers. If provided, overrides
                                      digit-based size detection for 50km squares.
    
    Returns:
        bool: True if the map was created successfully, False otherwise.
    """
    # Set default borders file path if not provided
    if borders_file is None:
        # Get the directory where this module is located
        module_dir = os.path.dirname(os.path.abspath(__file__))
        borders_file = os.path.join(module_dir, "finland_borders.geojson")
    
    # Read the GeoJSON file
    try:
        with open(borders_file, 'r') as f:
            geojson_data = json.load(f)
    except FileNotFoundError:
        print(f"Error: Borders file not found: {borders_file}")
        return False
    except json.JSONDecodeError as e:
        print(f"Error: Invalid JSON in borders file: {e}")
        return False
    
    # Extract coordinates from the MultiPolygon
    features = geojson_data.get('features', [])
    if not features:
        print("Error: No features found in GeoJSON")
        return False
    
    geometry = features[0].get('geometry', {})
    if geometry.get('type') != 'MultiPolygon':
        print(f"Error: Unexpected geometry type: {geometry.get('type')}")
        return False
    
    multipolygon = geometry['coordinates']
    
    # Create figure with white background
    fig, ax = plt.subplots(figsize=figsize, facecolor='white')
    ax.set_facecolor('white')
    
    # Plot each polygon in the MultiPolygon
    for polygon_group in multipolygon:
        for polygon in polygon_group:
            # Extract x and y coordinates
            coords = list(zip(*polygon))
            x_coords = coords[0]
            y_coords = coords[1]
            
            # Plot the polygon border
            ax.plot(x_coords, y_coords, 'k-', linewidth=0.5)
    
    # Collect unique color-value pairs for the legend
    legend_items = {}  # Dictionary to store unique color-value pairs
    
    # Add colored squares
    for square_key, data in squares_data.items():
        # Extract color and value from the data dictionary
        if not isinstance(data, dict):
            print(f"Warning: Invalid data format for {square_key}. Expected dict with 'color' and 'value' keys.")
            continue
        
        color = data.get('color')
        value = data.get('value')  # Extract value (not used for rendering, but available)
        
        if color is None:
            print(f"Warning: Missing 'color' key for {square_key}. Skipping.")
            continue
        
        # Store unique color-value pairs for legend
        # Use color as key, and keep track of values (in case same color has different values)
        if color not in legend_items:
            legend_items[color] = value
        # If same color has different values, we'll use the first one encountered
        # Parse the key (e.g., "668:338", "67:34", "6789:3458")
        try:
            northing_str, easting_str = square_key.split(':')
            
            # Determine grid size based on number of digits
            # 2 digits = 100km, 3 digits = 10km, 4 digits = 1km
            northing_digits = len(northing_str)
            easting_digits = len(easting_str)
            
            # Validate that both coordinates have the same number of digits
            if northing_digits != easting_digits:
                print(f"Warning: Mismatched coordinate digits in {square_key}. Expected same number of digits.")
                continue
            
            # Determine multiplier and square size based on digit count (and resolution_km for 50km)
            if northing_digits == 2:
                # 100km squares: "67:34" -> multiply by 100000
                multiplier = 100000
                square_size = 100000
            elif northing_digits == 3:
                if resolution_km == 50:
                    # 50km squares: "670:345" -> multiply by 10000, size is 50000
                    multiplier = 10000
                    square_size = 50000
                else:
                    # 10km squares: "668:338" -> multiply by 10000
                    multiplier = 10000
                    square_size = 10000
            elif northing_digits == 4:
                # 1km squares: "6789:3458" -> multiply by 1000
                multiplier = 1000
                square_size = 1000
            else:
                print(f"Warning: Unsupported coordinate format: {square_key}. Expected 2, 3, or 4 digits per coordinate.")
                continue
            
            northing = int(northing_str) * multiplier
            easting = int(easting_str) * multiplier
        except ValueError:
            print(f"Warning: Invalid square key format: {square_key}. Expected 'northing:easting'")
            continue
        
        # Calculate square corners
        # Southwestern corner: (easting, northing)
        # Northeastern corner: (easting + square_size, northing + square_size)
        square = Rectangle(
            (easting, northing),  # bottom-left corner (x, y)
            square_size,  # width
            square_size,  # height
            facecolor=color,
            edgecolor='none'
        )
        ax.add_patch(square)
    
    # Create legend
    if legend_items:
        # Sort legend items by value for better readability
        sorted_items = sorted(legend_items.items(), key=lambda x: x[1] if x[1] is not None else float('-inf'))
        
        # Limit legend to at most half of vertical space
        # Estimate ~22 pixels per legend entry (based on default matplotlib font)
        pixels_per_entry = 22
        max_legend_height = (figsize[1] * dpi) / 2
        max_entries = int(max_legend_height / pixels_per_entry)
        max_entries = max(2, max_entries)  # At least show 2 entries (min and max)
        
        # Subsample if too many items
        if len(sorted_items) > max_entries:
            # Pick evenly distributed indices, always including first and last
            indices = [0]  # Always include first (min value)
            if max_entries > 2:
                step = (len(sorted_items) - 1) / (max_entries - 1)
                for i in range(1, max_entries - 1):
                    indices.append(int(i * step))
            indices.append(len(sorted_items) - 1)  # Always include last (max value)
            # Remove duplicates while preserving order
            indices = list(dict.fromkeys(indices))
            sorted_items = [sorted_items[i] for i in indices]
        
        # Create legend handles and labels
        legend_handles = []
        legend_labels = []
        for color, value in sorted_items:
            patch = Patch(facecolor=color, edgecolor='black', linewidth=0.5)
            legend_handles.append(patch)
            # Format value for display
            if value is not None:
                if isinstance(value, float):
                    label = f"{value:.2f}" if value != int(value) else f"{int(value)}"
                else:
                    label = str(value)
            else:
                label = "N/A"
            legend_labels.append(label)
        
        # Add legend to the top left corner
        ax.legend(legend_handles, legend_labels, loc='upper left', framealpha=0.9, 
                 edgecolor='black', facecolor='white', frameon=True)
    
    # Remove axes for a clean look
    ax.axis('off')
    
    # Set equal aspect ratio and adjust limits
    ax.set_aspect('equal')
    
    # Ensure output directory exists
    output_dir = os.path.dirname(output_file)
    if output_dir and not os.path.exists(output_dir):
        os.makedirs(output_dir, exist_ok=True)
    
    # Save the figure
    plt.tight_layout()
    plt.savefig(output_file, dpi=dpi, bbox_inches='tight', facecolor='white')
    plt.close(fig)  # Close the figure to free memory
    
    print(f"Map saved to {output_file}")
    return True


# Allow running as a script for testing
if __name__ == "__main__":
    squares_data = {
        "668:338": {"color": "#ff0000", "value": 0.85},
        "669:338": {"color": "#00ff00", "value": 0.92},
        "666:333": {"color": "#0000ff", "value": 0.45}
    }
    output_file = "results/simplemap.png"
    create_finland_map(squares_data, output_file)
