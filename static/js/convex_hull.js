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

// Separate Leaflet layers per mode
const hullLayers = { max: null, min: null };

// Visual style per mode
const HULL_STYLES = {
    max: { color: '#ff7800', weight: 2, opacity: 0.9, fillColor: '#ff7800', fillOpacity: 0.12 },
    min: { color: '#3388ff', weight: 2, opacity: 0.9, fillColor: '#3388ff', fillOpacity: 0.12, dashArray: '6 4' }
};

// Store all features (geometry + properties)
const allFeatures = [];

// Helper to format ISO timestamp into a readable local string
function formatIsoTimestamp(iso) {
    if (!iso) return '-';
    const d = new Date(iso);
    if (isNaN(d)) return iso;
    return d.toLocaleString();
}

// Fetch and display one hull mode. Returns the response data or null.
async function fetchAndDisplayHull(mode) {
    const areaEl = document.getElementById(mode === 'max' ? 'areaMax' : 'areaMin');
    try {
        const response = await fetch(`/api/observations/${datasetId}/convex_hull?mode=${mode}`);
        if (!response.ok) {
            if (response.status === 404) {
                if (areaEl) areaEl.textContent = 'Ei laskettu';
                return null;
            }
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        if (!data.success || !data.geometry) {
            if (areaEl) areaEl.textContent = 'N/A';
            return null;
        }
        // Remove old layer for this mode
        if (hullLayers[mode]) map.removeLayer(hullLayers[mode]);
        const coords = data.geometry.coordinates[0];
        const latLngs = coords.map(c => [c[1], c[0]]);
        hullLayers[mode] = L.polygon(latLngs, HULL_STYLES[mode]).addTo(map);
        hullLayers[mode].bindTooltip(
            mode === 'max' ? `Laaja EOO: ${data.area_km2.toFixed(2)} km²`
                           : `Minimaalinen EOO: ${data.area_km2.toFixed(2)} km²`
        );
        if (areaEl) areaEl.textContent = `${data.area_km2.toFixed(2)} km²`;
        return data;
    } catch (error) {
        console.error(`Error fetching convex hull (${mode}):`, error);
        if (areaEl) areaEl.textContent = 'Virhe';
        return null;
    }
}

// Fetch and display both hulls in parallel, optionally fit map to the max hull
async function fetchAndDisplayConvexHull(fitMap = true) {
    const [maxData] = await Promise.all([
        fetchAndDisplayHull('max'),
        fetchAndDisplayHull('min')
    ]);
    // Fit map to the wider (max) hull
    if (fitMap && hullLayers.max) {
        try {
            const bounds = hullLayers.max.getBounds();
            if (bounds && bounds.isValid()) map.fitBounds(bounds, { padding: [50, 50] });
        } catch (e) { /* ignore */ }
    }
    // Update timestamp from max hull result
    const calEl = document.getElementById('calculated_at');
    if (calEl && maxData && maxData.calculated_at) {
        calEl.textContent = formatIsoTimestamp(maxData.calculated_at);
    }
    // Bring observation layer to front so features stay clickable
    try {
        if (window.sharedGeometryLayer && typeof window.sharedGeometryLayer.bringToFront === 'function') {
            window.sharedGeometryLayer.bringToFront();
        }
    } catch (e) { /* ignore */ }
}

// Calculate both hull modes on the server in a single request, then display
async function calculateConvexHull(fitMap = true) {
    // Check if we have enough features for convex hull
    if (stats.total < 3) {
        const msg = `Liian vähän havaintoja: monitahoiseen tarvitaan vähintään 3, sinulla on ${stats.total}`;
        updateStatus(`Virhe: ${msg}`);
        document.getElementById('areaMax').textContent = 'Ei saatavilla';
        document.getElementById('areaMin').textContent = 'Ei saatavilla';
        return;
    }

    updateStatus('Levinneisyysalueen laskenta käynnissä...');
    document.getElementById('areaMax').textContent = 'Lasketaan...';
    document.getElementById('areaMin').textContent = 'Lasketaan...';
    document.getElementById('calculated_at').textContent = 'Lasketaan...';
    const recalcBtn = document.getElementById('recalcBtn');
    if (recalcBtn) {
        recalcBtn.disabled = true;
        recalcBtn.style.opacity = '0.6';
        recalcBtn.style.cursor = 'not-allowed';
    }
    try {
        // Single POST — server computes both modes in one SQL pass
        const res = await fetch(`/api/observations/${datasetId}/convex_hull`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
        });
        if (!res.ok) {
            if (res.status === 400) {
                throw new Error('Riittämätön määrä havaintoja laskentaan');
            }
            throw new Error(`HTTP ${res.status}`);
        }
        const data = await res.json();
        if (!data.success) {
            // Check for insufficient features error from backend
            if (data.error && data.error.toLowerCase().includes('feature')) {
                throw new Error('Riittämätön määrä havaintoja laskentaan');
            }
            throw new Error(data.error || 'Laskenta epäonnistui');
        }
        updateStatus('Levinneisyysalueen laskenta onnistui');
        await fetchAndDisplayConvexHull(fitMap);
    } catch (error) {
        console.error('Error calculating convex hull:', error);
        updateStatus(`Virhe: ${error.message}`);
        document.getElementById('areaMax').textContent = 'Virhe';
        document.getElementById('areaMin').textContent = 'Virhe';
    } finally {
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
