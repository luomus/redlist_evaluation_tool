"""
Analysis methods for calculating species diversity metrics.
"""

import random
from collections import Counter


def calculate_speciescount(area_records):
    """
    Calculate species count (richness) for each grid cell.
    
    Args:
        area_records (dict): Dictionary mapping grid cells to lists of species names
                           Example: {"67:34": ["Species A", "Species B", "Species A"], ...}
    
    Returns:
        dict: Dictionary mapping grid cells to species counts
              Example: {"67:34": 2, "68:35": 5, ...}
    """
    result = {}
    for grid_cell, species_list in area_records.items():
        # Count unique species
        unique_species = set(species_list)
        result[grid_cell] = len(unique_species)
    
    return result


def build_accumulation_curve(species_list, n_iterations=1000):
    """
    Build a species accumulation curve by randomly shuffling records
    and tracking unique species found at each step.
    
    Args:
        species_list (list): List of species names (with duplicates representing abundance)
        n_iterations (int): Number of random permutations to average over
    
    Returns:
        list: Average number of unique species at each step
    """
    if not species_list:
        return []
    
    n_records = len(species_list)
    accumulation_curves = []
    
    for _ in range(n_iterations):
        # Shuffle the list randomly
        shuffled = species_list.copy()
        random.shuffle(shuffled)
        
        # Track unique species as we go through records
        seen_species = set()
        curve = []
        
        for species in shuffled:
            seen_species.add(species)
            curve.append(len(seen_species))
        
        accumulation_curves.append(curve)
    
    # Average across all iterations
    if not accumulation_curves:
        return []
    
    averaged_curve = []
    for i in range(n_records):
        step_values = [curve[i] for curve in accumulation_curves]
        averaged_curve.append(sum(step_values) / len(step_values))
    
    return averaged_curve


def calculate_chao1_estimator(species_counts):
    """
    Calculate Chao1 estimator for species richness.
    
    Chao1 = S_obs + (F1^2) / (2 * F2)
    where:
        S_obs = observed number of species
        F1 = number of singletons (species seen once)
        F2 = number of doubletons (species seen twice)
    
    Args:
        species_counts (dict or Counter): Dictionary mapping species to their counts
    
    Returns:
        float: Estimated total species richness
    """
    if not species_counts:
        return 0.0
    
    # Convert to Counter if needed
    if isinstance(species_counts, dict):
        counts = Counter(species_counts)
    else:
        counts = species_counts
    
    S_obs = len(counts)  # Observed species richness
    
    # Count singletons and doubletons
    F1 = sum(1 for count in counts.values() if count == 1)
    F2 = sum(1 for count in counts.values() if count == 2)
    
    # Bias-corrected Chao1 formula (Colwell & Coddington, 1994)
    # S_chao1 = S_obs + (F1 * (F1 - 1)) / (2 * (F2 + 1))
    # This formula is valid even when F2 is 0
    chao1 = S_obs + (F1 * (F1 - 1)) / (2.0 * (F2 + 1))
    
    return chao1


def calculate_incompleteness(area_species_list):
    """
    Calculate inventory incompleteness for an area using Chao1 estimator.
    
    Args:
        area_species_list (list): List of species names (with duplicates)
    
    Returns:
        float: Incompleteness ratio (0.0+), where 0.0 means fully sampled,
               higher values mean more species remain undiscovered
    """
    if not area_species_list:
        return 1.0
    
    # Count species occurrences
    species_counts = Counter(area_species_list)
    
    # Observed richness
    S_obs = len(species_counts)
    
    # Estimated richness using Chao1
    S_est = calculate_chao1_estimator(species_counts)
    
    if S_est == 0:
        return 1.0
    
    # Incompleteness = 1 - (Observed / Estimated)
    completeness = S_obs / S_est
    incompleteness = max(0.0, 1.0 - completeness)
    
    return incompleteness


def calculate_accumulation_slope(accumulation_curve):
    """
    Calculate the final slope of a species accumulation curve.
    This represents the rate of new species discovery per unit of effort.
    
    Args:
        accumulation_curve (list): Averaged species accumulation curve values
    
    Returns:
        float: Slope value (species per record)
    """
    if not accumulation_curve or len(accumulation_curve) < 2:
        return 0.0
    
    n_points = len(accumulation_curve)
    last_point = accumulation_curve[-1]
    
    # If fewer than 11 records (10 steps), calculate slope over entire range
    if n_points < 11:
        first_point = accumulation_curve[0]
        if n_points == 1:
            return 0.0
        slope = (last_point - first_point) / (n_points - 1)
    else:
        # Calculate slope between last point and 10 records back
        point_10_back = accumulation_curve[n_points - 11]  # Index is n_points - 11 (0-indexed)
        slope = (last_point - point_10_back) / 10.0
    
    return slope


def calculate_chao1(area_records):
    """
    Calculate Chao1 incompleteness for each grid cell.
    
    Args:
        area_records (dict): Dictionary mapping grid cells to lists of species names
                           Example: {"67:34": ["Species A", "Species B", "Species A"], ...}
    
    Returns:
        dict: Dictionary mapping grid cells to incompleteness values (0.0 = fully sampled,
              higher = more species likely remain undiscovered)
              Example: {"67:34": 0.15, "68:35": 0.08, ...}
    """
    result = {}
    for grid_cell, species_list in area_records.items():
        incompleteness = calculate_incompleteness(species_list)
        result[grid_cell] = incompleteness
    
    return result


def calculate_accumulation_curve(area_records):
    """
    Calculate accumulation curve slope for each grid cell.
    
    Args:
        area_records (dict): Dictionary mapping grid cells to lists of species names
                           Example: {"67:34": ["Species A", "Species B", "Species A"], ...}
    
    Returns:
        dict: Dictionary mapping grid cells to slope values
              Example: {"67:34": 0.05, "68:35": 0.12, ...}
    """
    result = {}
    for grid_cell, species_list in area_records.items():
        # Build accumulation curve with 1000 iterations for rarefaction
        accumulation_curve = build_accumulation_curve(species_list, n_iterations=1000)
        
        # Calculate the final slope of the accumulation curve
        slope = calculate_accumulation_slope(accumulation_curve)
        result[grid_cell] = slope
    
    return result


# Method registry for easy lookup
METHODS = {
    "speciescount": calculate_speciescount,
    "chao1": calculate_chao1,
    "accumulation_curve": calculate_accumulation_curve,
}


def get_method(method_name):
    """
    Get an analysis method by name.
    
    Args:
        method_name (str): Name of the method ("speciescount", "chao1", or "accumulation_curve")
    
    Returns:
        callable: The analysis function
    
    Raises:
        ValueError: If method name is not recognized
    """
    if method_name not in METHODS:
        raise ValueError(
            f"Unknown method: {method_name}. "
            f"Available methods: {', '.join(METHODS.keys())}"
        )
    return METHODS[method_name]

