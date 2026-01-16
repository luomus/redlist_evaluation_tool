/* global L, addGeometryToLayer */

// Get dataset ID from URL
const urlParams = new URLSearchParams(window.location.search);
const datasetId = urlParams.get('id');

if (!datasetId) {
    document.getElementById('status').textContent = 'Error: No dataset ID provided';
    throw new Error('No dataset ID provided');
}

// Create shared map and helpers
const { map, geometryLayer, stats, updateStatus } = createSharedMap();

// Per-feature handler that reuses shared `addGeometryToLayer`.
function addGeometryToMap(geometry, properties) {
    if (!geometry || !geometry.type) {
        stats.skipped++;
        return;
    }

    try {
        switch (geometry.type) {
            case 'Point':
                stats.points++;
                break;
            case 'LineString':
                stats.linestrings++;
                break;
            case 'Polygon':
                stats.polygons++;
                break;
            case 'MultiPoint':
                stats.multipoints++;
                break;
            case 'MultiLineString':
                stats.multilinestrings++;
                break;
            case 'MultiPolygon':
                stats.multipolygons++;
                break;
            case 'GeometryCollection':
                stats.geometrycollections++;
                if (geometry.geometries && Array.isArray(geometry.geometries)) {
                    geometry.geometries.forEach(geom => addGeometryToMap(geom, properties));
                }
                return;
            default:
                console.warn('Unknown geometry type:', geometry.type);
                stats.skipped++;
                return;
        }

        addGeometryToLayer(geometry, properties, geometryLayer);
    } catch (error) {
        console.error('Error adding geometry to map:', error, geometry);
        stats.skipped++;
    }
}

// Use the generic fetcher and provide callbacks
fetchAllObservationsGeneric(datasetId,
    (feature) => {
        if (feature.geometry) addGeometryToMap(feature.geometry, feature.properties || {});
        else stats.skipped++;
    },
    updateStatus,
    ({ datasetName, total }) => {
        stats.total = total || stats.total;
        const bounds = geometryLayer.getBounds();
        if (bounds.isValid()) map.fitBounds(bounds, { padding: [50, 50] });

        const statusMessage = `${datasetName}: ${stats.total} observations loaded | ` +
            `Points: ${stats.points} | Lines: ${stats.linestrings} | Polygons: ${stats.polygons} | ` +
            `MultiPoints: ${stats.multipoints} | MultiLines: ${stats.multilinestrings} | ` +
            `MultiPolygons: ${stats.multipolygons} | GeometryCollections: ${stats.geometrycollections}` +
            (stats.skipped > 0 ? ` | Skipped: ${stats.skipped}` : '');

        updateStatus(statusMessage);
    }
);
