/* global L */

// ─────────────────────────────────────────────────────────────────────────
// Pure geometry utilities for map operations
// No dependencies on map instance, UI state, or other modules
// ─────────────────────────────────────────────────────────────────────────

/**
 * Ray-casting point-in-polygon test (latlng objects {lat, lng})
 * Used for Leaflet point objects
 */
window.pointInPolygon = function(pt, vs) {
    const x = pt.lng, y = pt.lat;
    let inside = false;
    for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
        const xi = vs[i].lng, yi = vs[i].lat;
        const xj = vs[j].lng, yj = vs[j].lat;
        const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi + 0.0) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
};

/**
 * Flatten nested latlngs to a flat array of latlng objects
 */
window.flattenLatLngs = function(arr) {
    const out = [];
    (function rec(a) {
        if (!a) return;
        if (Array.isArray(a)) {
            a.forEach(v => rec(v));
        } else if (a.lat !== undefined && a.lng !== undefined) {
            out.push(a);
        }
    })(arr);
    return out;
};

/**
 * Pixel distance from point p to segment [a, b] (Leaflet Point objects)
 */
window.distToSegment = function(p, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    if (dx === 0 && dy === 0) return p.distanceTo(a);
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
    return p.distanceTo(L.point(a.x + t * dx, a.y + t * dy));
};

/**
 * Compute centroid [lat, lng] of a GeoJSON Polygon or MultiPolygon geometry
 */
window.polygonCentroid = function(geometry) {
    let coords = [];
    if (geometry.type === 'Polygon') {
        coords = geometry.coordinates[0] || [];
    } else if (geometry.type === 'MultiPolygon') {
        geometry.coordinates.forEach(poly => {
            (poly[0] || []).forEach(c => coords.push(c));
        });
    }
    if (!coords.length) return { lat: 0, lng: 0 };
    let sumLng = 0, sumLat = 0;
    coords.forEach(c => { sumLng += c[0]; sumLat += c[1]; });
    return { lat: sumLat / coords.length, lng: sumLng / coords.length };
};

/**
 * Ray-casting point-in-polygon test
 * point = [lng, lat], ring = [[lng,lat], ...]
 * Used for GeoJSON coordinates
 */
window.pointInPolygonRing = function(point, ring) {
    const x = point[0], y = point[1];
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const xi = ring[i][0], yi = ring[i][1];
        const xj = ring[j][0], yj = ring[j][1];
        const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
};

/**
 * Check whether point [lng, lat] is inside a GeoJSON Polygon or MultiPolygon geometry
 */
window.pointInPolygonGeometry = function(point, geometry) {
    if (!geometry) return false;
    if (geometry.type === 'Polygon') {
        return window.pointInPolygonRing(point, geometry.coordinates[0] || []);
    } else if (geometry.type === 'MultiPolygon') {
        for (const poly of geometry.coordinates) {
            if (window.pointInPolygonRing(point, poly[0] || [])) return true;
        }
        return false;
    }
    return false;
};
