/* global L, createGeometryLayers, fetchAllObservationsGeneric, createSharedMap */

// Get project ID from URL
const urlParamsGrid = new URLSearchParams(window.location.search);
const projectId = urlParamsGrid.get('id');

if (!projectId) {
    document.getElementById('status').textContent = 'Error: No project ID provided';
    throw new Error('No project ID provided');
}

// Fetch project name for nicer UI messages
let projectNameGrid = `Project ${projectId}`;
(async () => {
    try {
        const resp = await fetch(`/api/projects/${projectId}`);
        if (resp.ok) {
            const json = await resp.json();
            if (json.success && json.project && json.project.name) {
                projectNameGrid = json.project.name;
            }
        }
    } catch (e) {
        // ignore
    }
})();

// Create shared map and helpers
const { map, geometryLayer, stats, updateStatus } = createSharedMap();

// Layer for grid cells
let gridLayer = null;

// Helper to format ISO timestamp into a readable local string
function formatIsoTimestamp(iso) {
    if (!iso) return '-';
    const d = new Date(iso);
    if (isNaN(d)) return iso;
    return d.toLocaleString();
}

// Fetch and display grid from the backend
async function fetchAndDisplayGrid(fitMap = true) {
    try {
        const response = await fetch(`/api/observations/${projectId}/grid`);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const data = await response.json();

        // Remove existing grid layer
        if (gridLayer) {
            map.removeLayer(gridLayer);
            gridLayer = null;
        }

        // Convert features into Leaflet layer
        const features = data.features || [];
        const polygons = [];
        for (const f of features) {
            if (!f.geometry) continue;
            try {
                const coords = f.geometry.coordinates[0];
                const latLngs = coords.map(c => [c[1], c[0]]);
                const poly = L.polygon(latLngs, {
                    color: '#3388ff',
                    weight: 1,
                    opacity: 0.8,
                    fillColor: '#3388ff',
                    fillOpacity: 0.15
                });
                polygons.push(poly);
            } catch (e) {
                // skip invalid geometry
            }
        }

        if (polygons.length > 0) {
            gridLayer = L.featureGroup(polygons).addTo(map);
            if (fitMap) {
                try {
                    const bounds = gridLayer.getBounds();
                    if (bounds && bounds.isValid()) map.fitBounds(bounds, { padding: [50, 50] });
                } catch (e) {
                    // ignore
                }
            }
            document.getElementById('cellsCount').textContent = `${polygons.length}`;
        } else {
            document.getElementById('cellsCount').textContent = '0';
        }

    } catch (error) {
        console.error('Error fetching grid:', error);
        updateStatus(`Error: ${error.message}`);
        document.getElementById('cellsCount').textContent = 'Error';
    }
}

// Calculate/generate grid on the server
async function calculateGrid(fitMap = true) {
    try {
        updateStatus('Generating grid...');
        const genBtn = document.getElementById('genBtn');
        if (genBtn) {
            genBtn.disabled = true;
            genBtn.style.opacity = '0.6';
            genBtn.style.cursor = 'not-allowed';
        }

        const response = await fetch(`/api/observations/${projectId}/grid`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });

        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const data = await response.json();
        if (!data.success) throw new Error(data.error || 'Failed to generate grid');

        updateStatus('Grid generated successfully');

        // Fetch and display the newly generated grid
        await fetchAndDisplayGrid(fitMap);

        if (genBtn) {
            genBtn.disabled = false;
            genBtn.style.opacity = '';
            genBtn.style.cursor = '';
        }

    } catch (error) {
        console.error('Error generating grid:', error);
        updateStatus(`Error: ${error.message}`);
        const genBtn = document.getElementById('genBtn');
        if (genBtn) {
            genBtn.disabled = false;
            genBtn.style.opacity = '';
            genBtn.style.cursor = '';
        }
    }
}

// Expose functions for button
window.createGrid = calculateGrid;
window.fetchAndDisplayGrid = fetchAndDisplayGrid;

// Collect all features before rendering for optimal performance
const allFeaturesToRender = [];

// Start loading data when page loads and then fetch grid
fetchAllObservationsGeneric(projectId,
    (feature) => {
        // Just collect features without drawing yet
        allFeaturesToRender.push(feature);
    },
    updateStatus,
    ({ datasetName, total }) => {
        // Now render all features at once
        const nameForStatus = projectNameGrid || datasetName || `Project ${projectId}`;
        updateStatus(`${nameForStatus}: Rendering ${allFeaturesToRender.length} observations...`);
        
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
        
        const statusMessage = `${nameForStatus}: ${stats.total} observations loaded` + (stats.skipped > 0 ? ` | Skipped: ${stats.skipped}` : '');
        updateStatus(statusMessage);
        // Fetch grid after observations loaded
        fetchAndDisplayGrid(true);
        
        // Sync legend with actual feature exclusion state after all features are loaded
        if (typeof window.syncLegendWithFeatures === 'function') {
            try { window.syncLegendWithFeatures(); } catch (e) { console.warn('Legend sync failed:', e); }
        }
    }
);