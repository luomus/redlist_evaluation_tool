/* global L, addGeometryToMap, fetchAllObservationsGeneric, createSharedMap */

// Get dataset ID from URL
const urlParams = new URLSearchParams(window.location.search);
const datasetId = urlParams.get('id');

if (!datasetId) {
    document.getElementById('status').textContent = 'Error: No dataset ID provided';
    throw new Error('No dataset ID provided');
}

// Create shared map and helpers
const { map, geometryLayer, stats, updateStatus } = createSharedMap();

// Layer for convex hull
let hullLayer = null;

// Store all features (geometry + properties)
const allFeatures = [];

// Helper to format ISO timestamp into a readable local string
function formatIsoTimestamp(iso) {
    if (!iso) return '-';
    const d = new Date(iso);
    if (isNaN(d)) return iso;
    return d.toLocaleString();
}

// Fetch and display convex hull from the backend
async function fetchAndDisplayConvexHull(fitMap = true) {
    try {
        const response = await fetch(`/api/observations/${datasetId}/convex_hull`);
        
        if (!response.ok) {
            if (response.status === 404) {
                // Convex hull not calculated yet
                document.getElementById('areaValue').textContent = 'Not calculated';
                document.getElementById('calculated_at').textContent = 'Not calculated';
                console.log('Convex hull not calculated yet. Click "Re-calculate Hull" button.');
                return;
            }
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        
        if (!data.success || !data.geometry) {
            document.getElementById('areaValue').textContent = 'N/A';
            document.getElementById('calculated_at').textContent = '-';
            return;
        }
        
        // Remove existing hull layer
        if (hullLayer) {
            map.removeLayer(hullLayer);
        }
        
        // Coordinates are in WGS84 (lon, lat) so just swap to Leaflet's [lat, lon]
        const coords = data.geometry.coordinates[0]; // Polygon outer ring
        const latLngs = coords.map(coord => [coord[1], coord[0]]);
        
        hullLayer = L.polygon(latLngs, {
            color: '#ff7800',
            weight: 2,
            opacity: 0.8,
            fillColor: '#ff7800',
            fillOpacity: 0.2
        }).addTo(map);
        
        // Optionally fit map to hull bounds
        if (fitMap) {
            try {
                const bounds = hullLayer.getBounds();
                if (bounds && bounds.isValid()) map.fitBounds(bounds, { padding: [50, 50] });
            } catch (e) {
                // ignore
            }
        }
        
        // Ensure the shared data layer is above the hull so features remain clickable
        try {
            if (window.sharedGeometryLayer && typeof window.sharedGeometryLayer.bringToFront === 'function') {
                window.sharedGeometryLayer.bringToFront();
            }
        } catch (e) {
            // ignore
        }
        
        // Display area and calculation timestamp
        document.getElementById('areaValue').textContent = `${data.area_km2.toFixed(2)} km²`;
        document.getElementById('calculated_at').textContent = formatIsoTimestamp(data.calculated_at);
        
    } catch (error) {
        console.error('Error fetching convex hull:', error);
        document.getElementById('areaValue').textContent = 'Error';
        document.getElementById('calculated_at').textContent = 'Error';
    }
}

// Calculate convex hull on the server
async function calculateConvexHull(fitMap = true) {
    try {
        updateStatus('Calculating convex hull...');
        document.getElementById('areaValue').textContent = 'Calculating...';
        document.getElementById('calculated_at').textContent = 'Calculating...';
        // Disable recalc button while operation runs
        let recalcBtn = document.getElementById('recalcBtn');
        if (recalcBtn) {
            recalcBtn.disabled = true;
            recalcBtn.style.opacity = '0.6';
            recalcBtn.style.cursor = 'not-allowed';
        }

        const response = await fetch(`/api/observations/${datasetId}/convex_hull`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        
        if (!data.success) {
            throw new Error(data.error || 'Failed to calculate convex hull');
        }
        
        updateStatus('Convex hull calculated successfully');
        
        // Fetch and display the newly calculated hull
        await fetchAndDisplayConvexHull(fitMap);

        // Re-enable recalc button
        if (recalcBtn) {
            recalcBtn.disabled = false;
            recalcBtn.style.opacity = '';
            recalcBtn.style.cursor = '';
        }
        
    } catch (error) {
        console.error('Error calculating convex hull:', error);
        updateStatus(`Error: ${error.message}`);
        document.getElementById('areaValue').textContent = 'Error';
        document.getElementById('calculated_at').textContent = 'Error';
        if (recalcBtn) {
            recalcBtn.disabled = false;
            recalcBtn.style.opacity = '';
            recalcBtn.style.cursor = '';
        }
    }
}

// Expose functions for the re-calculate button and external modules
window.createConvexHull = calculateConvexHull;
window.fetchAndDisplayConvexHull = fetchAndDisplayConvexHull;

// Start loading data when page loads
// Use generic fetcher and then fetch hull from backend
fetchAllObservationsGeneric(datasetId,
    (feature) => {
        if (feature.geometry) {
            allFeatures.push(feature); // Store complete feature with properties
            addGeometryToMap(feature.geometry, feature.properties || {}, geometryLayer, stats);
        }
    },
    updateStatus,
    ({ datasetName, total }) => {
        stats.total = total || stats.total;
        
        // Fetch pre-calculated convex hull from backend instead of calculating client-side
        fetchAndDisplayConvexHull(true);

        const statusMessage = `${datasetName}: ${stats.total} observations loaded` +
            (stats.skipped > 0 ? ` | Skipped: ${stats.skipped}` : '');

        updateStatus(statusMessage);
        
        // Sync legend with actual feature exclusion state after all features are loaded
        if (typeof window.syncLegendWithFeatures === 'function') {
            try { window.syncLegendWithFeatures(); } catch (e) { console.warn('Legend sync failed:', e); }
        }
    }
);
