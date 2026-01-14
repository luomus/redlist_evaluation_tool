"""
Color utility functions for generating color ramps.
"""


def hex_color_ramp(value, min_val, max_val):
    """
    Generate a color from blue (low) to red (high) based on value.
    Returns a hex color string.
    
    Args:
        value (float): The value to map to a color
        min_val (float): Minimum value in the range
        max_val (float): Maximum value in the range
    
    Returns:
        str: Hex color code (e.g., "#ff0000")
    """
    if max_val == min_val:
        return "#0000ff"  # Default to blue if all values are the same
    
    # Normalize value to 0-1 range
    normalized = (value - min_val) / (max_val - min_val)
    
    # Create color ramp: blue (low) -> cyan -> yellow -> red (high)
    if normalized < 0.33:
        # Blue to cyan
        r = 0
        g = int(255 * (normalized / 0.33))
        b = 255
    elif normalized < 0.67:
        # Cyan to yellow
        r = int(255 * ((normalized - 0.33) / 0.34))
        g = 255
        b = int(255 * (1 - (normalized - 0.33) / 0.34))
    else:
        # Yellow to red
        r = 255
        g = int(255 * (1 - (normalized - 0.67) / 0.33))
        b = 0
    
    return f"#{r:02x}{g:02x}{b:02x}"


def add_colors_to_values(values_dict):
    """
    Add color mapping to a dictionary of grid cell values.
    
    Args:
        values_dict (dict): Dictionary mapping grid cells to numeric values
                          Example: {"67:34": 0.85, "68:35": 0.92}
    
    Returns:
        dict: Dictionary with color and value for each grid cell
              Example: {"67:34": {"color": "#ff0000", "value": 0.85}, ...}
    """
    if not values_dict:
        return {}
    
    values = list(values_dict.values())
    min_val = min(values)
    max_val = max(values)
    
    result = {}
    for grid_cell, value in values_dict.items():
        color = hex_color_ramp(value, min_val, max_val)
        result[grid_cell] = {
            "color": color,
            "value": value
        }
    
    return result

