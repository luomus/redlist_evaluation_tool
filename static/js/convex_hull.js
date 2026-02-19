/* global L, createGeometryLayers, fetchAllObservationsGeneric, createSharedMap */

// Get dataset ID from URL
const urlParams = new URLSearchParams(window.location.search);
const datasetId = urlParams.get('id');

if (!datasetId) {
    document.getElementById('status').textContent = 'Virhe: Aineiston tunnistetta ei annettu';
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
                document.getElementById('areaValue').textContent = 'Ei laskettu';
                document.getElementById('calculated_at').textContent = 'Ei laskettu';
                console.log('Convex hull -aluetta ei ole vielä laskettu. Käytä painiketta "Laske uudelleen".');
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
        document.getElementById('areaValue').textContent = 'Virhe';
        document.getElementById('calculated_at').textContent = 'Virhe';
    }
}

// Calculate convex hull on the server
async function calculateConvexHull(fitMap = true) {
    try {
        updateStatus('Levinneisyysalueen laskenta käynnissä...');
        document.getElementById('areaValue').textContent = 'Lasketaan...';
        document.getElementById('calculated_at').textContent = 'Lasketaan...';
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
        
        updateStatus('Levinneisyysalueen laskenta onnistui');
        
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
        updateStatus(`Virhe: ${error.message}`);
        document.getElementById('areaValue').textContent = 'Virhe';
        document.getElementById('calculated_at').textContent = 'Virhe';
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

// Collect all features before rendering for optimal performance
const allFeaturesToRender = [];

// Start loading data when page loads
// Use generic fetcher and then fetch hull from backend
fetchAllObservationsGeneric(datasetId,
    (feature) => {
        // Just collect features without drawing yet
        allFeaturesToRender.push(feature);
    },
    updateStatus,
    ({ datasetName, total }) => {
        // Now render all features at once
        updateStatus(`${datasetName}: Näytetään ${allFeaturesToRender.length} havaintoa...`);
        
        const layers = [];
        
        // Create all layers
        allFeaturesToRender.forEach(feature => {
            if (feature.geometry) {
                allFeatures.push(feature); // Store complete feature with properties
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
        
        // Fetch pre-calculated convex hull from backend instead of calculating client-side
        fetchAndDisplayConvexHull(true);

        const statusMessage = `${datasetName}: ${stats.total} havaintoa ladattu` +
            (stats.skipped > 0 ? ` | Skipattu: ${stats.skipped}` : '');

        updateStatus(statusMessage);
        
        // Sync legend with actual feature exclusion state after all features are loaded
        if (typeof window.syncLegendWithFeatures === 'function') {
            try { window.syncLegendWithFeatures(); } catch (e) { console.warn('Legend sync failed:', e); }
        }
    }
);
