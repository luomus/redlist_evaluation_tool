"""
Grid cell conversion utilities for different resolutions.
"""


def convert_to_resolution(grid_cell, target_resolution_km):
    """
    Convert a grid cell coordinate to the specified resolution.
    
    Args:
        grid_cell (str): Grid cell in format "northing:easting" (e.g., "6789:3458")
        target_resolution_km (int): Target resolution in kilometers (1, 10, or 100)
    
    Returns:
        str: Grid cell in the target resolution format, or None if conversion fails
    """
    try:
        northing_str, easting_str = grid_cell.split(':')
        
        # Determine number of digits needed for target resolution
        if target_resolution_km == 1:
            digits_needed = 4
        elif target_resolution_km == 10:
            digits_needed = 3
        elif target_resolution_km == 50:
            digits_needed = 3
        elif target_resolution_km == 100:
            digits_needed = 2
        else:
            return None
        
        # Convert to integers and truncate to desired number of digits
        northing = int(northing_str)
        easting = int(easting_str)
        
        # Calculate divisor based on current number of digits and target
        # If input has more digits than needed, truncate from the right
        current_northing_digits = len(northing_str)
        current_easting_digits = len(easting_str)
        
        if current_northing_digits > digits_needed:
            divisor = 10 ** (current_northing_digits - digits_needed)
            northing = northing // divisor
        elif current_northing_digits < digits_needed:
            # Pad with zeros if input has fewer digits (shouldn't happen normally)
            northing = northing * (10 ** (digits_needed - current_northing_digits))
        
        if current_easting_digits > digits_needed:
            divisor = 10 ** (current_easting_digits - digits_needed)
            easting = easting // divisor
        elif current_easting_digits < digits_needed:
            # Pad with zeros if input has fewer digits (shouldn't happen normally)
            easting = easting * (10 ** (digits_needed - current_easting_digits))
        
        # For 50 km resolution, round down so last digit is 0 or 5
        if target_resolution_km == 50:
            northing = (northing // 5) * 5
            easting = (easting // 5) * 5
        
        # Format with leading zeros if needed to match exact digit count
        return f"{northing:0{digits_needed}d}:{easting:0{digits_needed}d}"
    
    except (ValueError, AttributeError):
        return None

