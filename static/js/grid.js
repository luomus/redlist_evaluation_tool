/* global L, addGeometryToMap, fetchAllObservationsGeneric, createSharedMap */

// Get dataset ID from URL
const urlParamsGrid = new URLSearchParams(window.location.search);
const datasetIdGrid = urlParamsGrid.get('id');

if (!datasetIdGrid) {
    document.getElementById('status').textContent = 'Error: No dataset ID provided';
    throw new Error('No dataset ID provided');
}

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
        const response = await fetch(`/api/observations/${datasetIdGrid}/grid`);
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

        const response = await fetch(`/api/observations/${datasetIdGrid}/grid`, {
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

// Start loading data when page loads and then fetch grid
fetchAllObservationsGeneric(datasetIdGrid,
    (feature) => {
        if (feature.geometry) {
            addGeometryToMap(feature.geometry, feature.properties || {}, geometryLayer, stats);
        }
    },
    updateStatus,
    ({ datasetName, total }) => {
        const statusMessage = `${datasetName}: ${stats.total} observations loaded` + (stats.skipped > 0 ? ` | Skipped: ${stats.skipped}` : '');
        updateStatus(statusMessage);
        // Fetch grid after observations loaded
        fetchAndDisplayGrid(true);
    }
);