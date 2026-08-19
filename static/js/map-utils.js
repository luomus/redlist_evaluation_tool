/* global L */

// Utility functions shared across map modules

/**
 * Determine accuracy class from coordinateAccuracy value (in meters)
 * Classes: 1-10m, 11-100m, 101-1000m, 1001-10000m, 10001-100000m
 * 
 * @param {number|string} coordinateAccuracy - The coordinate accuracy in meters
 * @returns {string|null} - CSS class name like 'accuracy-1-10' or null if no match
 */
window.getAccuracyClass = function(coordinateAccuracy) {
    if (!coordinateAccuracy) return null;
    
    const accuracy = parseFloat(coordinateAccuracy);
    if (isNaN(accuracy)) return null;
    
    if (accuracy <= 10) return 'accuracy-1-10';
    if (accuracy <= 100) return 'accuracy-11-100';
    if (accuracy <= 1000) return 'accuracy-101-1000';
    if (accuracy <= 10000) return 'accuracy-1001-10000';
    if (accuracy <= 100000) return 'accuracy-10001-100000';
    
    return null;
};

/**
 * Format ISO 8601 timestamp using Finnish date and time conventions.
 * 
 * @param {string} iso - ISO 8601 formatted timestamp
 * @returns {string} - Formatted date/time string or original input if invalid
 */
window.formatIsoTimestamp = function(iso) {
    if (!iso) return '-';
    const d = new Date(iso);
    if (isNaN(d)) return iso;
    return d.toLocaleString('fi-FI');
};

/**
 * Format an area as whole square kilometres with Finnish thousands separators.
 *
 * @param {number|string} areaKm2 - Area in square kilometres
 * @returns {string} Formatted area or '-' if invalid
 */
window.formatAreaKm2 = function(areaKm2) {
    const area = Number(areaKm2);
    if (!Number.isFinite(area)) return '-';
    return Math.round(area).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
};
