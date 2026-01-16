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

// Use the generic fetcher and provide callbacks
fetchAllObservationsGeneric(datasetId,
    (feature) => {
        if (feature.geometry) addGeometryToMap(feature.geometry, feature.properties || {}, geometryLayer, stats);
        else stats.skipped++;
    },
    updateStatus,
    ({ datasetName, total }) => {
        stats.total = total || stats.total;
        const bounds = geometryLayer.getBounds();
        if (bounds.isValid()) map.fitBounds(bounds, { padding: [50, 50] });

        const statusMessage = `${datasetName}: ${stats.total} observations loaded` +
            (stats.skipped > 0 ? ` | Skipped: ${stats.skipped}` : '');

        updateStatus(statusMessage);
    }
);
