/* global L, addGeometryToLayer */

// Get dataset ID from URL
const urlParams = new URLSearchParams(window.location.search);
const datasetId = urlParams.get('id');
// Expose the current project id so other shared code can scope requests (legend, etc.)
window.currentProjectId = datasetId;

if (!datasetId) {
    document.getElementById('status').textContent = 'Error: No dataset ID provided';
    throw new Error('No dataset ID provided');
}

// Create shared map and helpers
const { map, geometryLayer, stats, updateStatus } = createSharedMap();

// Collect all features before rendering for optimal performance
const allFeaturesToRender = [];

// Use the generic fetcher and provide callbacks
fetchAllObservationsGeneric(datasetId,
    (feature) => {
        // Just collect features without drawing yet
        allFeaturesToRender.push(feature);
    },
    updateStatus,
    ({ datasetName, total }) => {
        // Now render all features at once
        updateStatus(`Rendering ${allFeaturesToRender.length} observations...`);
        
        const layers = [];
        
        // Create all layers
        allFeaturesToRender.forEach(feature => {
            if (feature.geometry) {
                try {
                    const layer = createGeometryLayers(feature.geometry, feature.properties || {});
                    if (layer) {
                        if (Array.isArray(layer)) layers.push(...layer);
                        else layers.push(layer);
                        stats.total++;
                    }
                } catch (err) {
                    console.error('Error creating layer:', err);
                    stats.skipped++;
                }
            } else {
                stats.skipped++;
            }
        });
        
        // Add all layers to map in a single operation
        if (layers.length > 0) {
            layers.forEach(layer => geometryLayer.addLayer(layer));
        }
        
        stats.total = total || stats.total;
        const bounds = geometryLayer.getBounds();
        if (bounds.isValid()) map.fitBounds(bounds, { padding: [50, 50] });

        const statusMessage = `${datasetName}: ${stats.total} observations loaded` +
            (stats.skipped > 0 ? ` | Skipped: ${stats.skipped}` : '');

        updateStatus(statusMessage);
        
        // Sync legend with actual feature exclusion state after all features are loaded
        if (typeof window.syncLegendWithFeatures === 'function') {
            try { window.syncLegendWithFeatures(); } catch (e) { console.warn('Legend sync failed:', e); }
        }
    }
);
