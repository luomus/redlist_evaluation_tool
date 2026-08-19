/* global L, createGeometryLayers, fetchAllObservationsGeneric, createSharedMap */

// MX_ID is injected by the Flask template as window.MX_ID
const datasetId = window.MX_ID;

if (!datasetId) {
    document.getElementById('status').textContent = 'Virhe: Taksonin tunnistetta ei löydy';
    throw new Error('No taxon MX_ID provided');
}

// Create shared map and helpers
const { map, geometryLayer, stats, updateStatus } = createSharedMap();

// Fetch project name for nicer UI messages
let projectName = `Laji ${datasetId}`;
(async () => {
    try {
        const resp = await fetch(`/api/taxons/${datasetId}`);
        if (resp.ok) {
            const json = await resp.json();
            if (json.success && json.taxon && json.taxon.name) {
                projectName = json.taxon.name;
            }
        }
    } catch (e) {
        // ignore
    }
})();

// Separate Leaflet layers per mode
const hullLayers = { max: null, min: null };

// Layer for grid cells
let gridLayer = null;

// Visual style per mode
const HULL_STYLES = {
    max: { color: '#ff7800', weight: 2, opacity: 0.9, fillColor: '#ff7800', fillOpacity: 0.12 },
    min: { color: '#3388ff', weight: 2, opacity: 0.9, fillColor: '#3388ff', fillOpacity: 0.12, dashArray: '6 4' }
};

// Store all features (geometry + properties)
const allFeatures = [];


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
            mode === 'max' ? `Laaja EOO: ${formatAreaKm2(data.area_km2)} km²`
                           : `Suppea EOO: ${formatAreaKm2(data.area_km2)} km²`
        );
        if (areaEl) areaEl.textContent = `${formatAreaKm2(data.area_km2)} km²`;
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

// Fetch and display grid from the backend
async function fetchAndDisplayGrid(fitMap = true) {
    try {
        const response = await fetch(`/api/observations/${datasetId}/grid`);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const data = await response.json();

        if (gridLayer) {
            map.removeLayer(gridLayer);
            gridLayer = null;
        }

        const features = data.features || [];
        const polygons = [];

        // Keep grid under observation overlays so point/polygon clicks still work.
        if (!map.getPane('gridPane')) {
            map.createPane('gridPane');
            const gp = map.getPane('gridPane');
            gp.style.zIndex = 350;
        }

        for (const f of features) {
            if (!f.geometry) continue;
            try {
                const coords = f.geometry.coordinates[0];
                const latLngs = coords.map(c => [c[1], c[0]]);
                const poly = L.polygon(latLngs, {
                    pane: 'gridPane',
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
            window.sharedGridFeatures = features;

            if (fitMap) {
                try {
                    const bounds = gridLayer.getBounds();
                    if (bounds && bounds.isValid()) map.fitBounds(bounds, { padding: [50, 50] });
                } catch (e) {
                    // ignore
                }
            }
            document.getElementById('cellsCount').textContent = `${polygons.length}`;
            document.getElementById('aooArea').textContent = `${formatAreaKm2(polygons.length * 4)} km²`;
            
            // Update grid creation timestamp
            const aooTimeEl = document.getElementById('aoo_calculated_at');
            if (aooTimeEl && data.created_at) {
                aooTimeEl.textContent = formatIsoTimestamp(data.created_at);
            }
        } else {
            window.sharedGridFeatures = [];
            document.getElementById('cellsCount').textContent = '0';
            document.getElementById('aooArea').textContent = '0 km²';
        }
    } catch (error) {
        console.error('Error fetching grid:', error);
        updateStatus(`Virhe: ${error.message}`);
        document.getElementById('cellsCount').textContent = 'Virhe';
        document.getElementById('aooArea').textContent = 'Virhe';
    }
}

// Calculate/generate grid on the server
async function calculateGrid(fitMap = true) {
    try {
        updateStatus('Generoidaan esiintymisaluetta...');
        const genBtn = document.getElementById('genBtn');
        if (genBtn) {
            genBtn.disabled = true;
            genBtn.style.opacity = '0.6';
            genBtn.style.cursor = 'not-allowed';
        }

        const response = await fetch(`/api/observations/${datasetId}/grid`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });

        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const data = await response.json();
        if (!data.success) throw new Error(data.error || 'Failed to generate grid');

        updateStatus('Esiintymisalue luotu!');
        await fetchAndDisplayGrid(fitMap);
    } catch (error) {
        console.error('Error generating grid:', error);
        updateStatus(`Virhe: ${error.message}`);
    } finally {
        const genBtn = document.getElementById('genBtn');
        if (genBtn) {
            genBtn.disabled = false;
            genBtn.style.opacity = '';
            genBtn.style.cursor = '';
        }
    }
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
window.createGrid = calculateGrid;
window.fetchAndDisplayGrid = fetchAndDisplayGrid;

// Collect all features before rendering for optimal performance
const allFeaturesToRender = [];

// Function to load and render observations on the map
function loadObservationsOnMap() {
    // Use generic fetcher and then fetch hull from backend
    fetchAllObservationsGeneric(datasetId,
        (feature) => {
            // Just collect features without drawing yet
            allFeaturesToRender.push(feature);
        },
        updateStatus,
        ({ datasetName, total }) => {
            // Now render all features at once
            const nameForStatus = projectName || datasetName || `Laji ${datasetId}`;
            updateStatus(`${nameForStatus}: Näytetään ${allFeaturesToRender.length} havaintoa...`);
            
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
            
            // Fetch both overlays after observations are loaded.
            fetchAndDisplayGrid(false);
            fetchAndDisplayConvexHull(true);

            const statusMessage = `${nameForStatus}: ${stats.total} havaintoa ladattu` +
                (stats.skipped > 0 ? ` | Skipattu: ${stats.skipped}` : '');

            updateStatus(statusMessage);
            
            // Update observation count in info-panel
            const countEl = document.getElementById('observationCount');
            if (countEl) {
                countEl.textContent = stats.total;
            }
            
            // Sync legend with actual feature exclusion state after all features are loaded
            if (typeof window.syncLegendWithFeatures === 'function') {
                try { window.syncLegendWithFeatures(); } catch (e) { console.warn('Legend sync failed:', e); }
            }
        }
    );
}

// Function to reload observations after new data has been uploaded/imported
async function reloadMapObservations() {
    updateStatus('Päivitetään karttanäkymä...');
    
    // Clear existing geometry layer
    geometryLayer.clearLayers();
    
    // Reset stats and feature arrays
    allFeatures.length = 0;
    allFeaturesToRender.length = 0;
    stats.total = 0;
    stats.skipped = 0;
    
    // Clear convex hull layers
    if (hullLayers.max) {
        map.removeLayer(hullLayers.max);
        hullLayers.max = null;
    }
    if (hullLayers.min) {
        map.removeLayer(hullLayers.min);
        hullLayers.min = null;
    }
    
    // Clear grid layer
    if (gridLayer) {
        map.removeLayer(gridLayer);
        gridLayer = null;
    }
    
    // Reload observations
    loadObservationsOnMap();
}

window.reloadMapObservations = reloadMapObservations;

// Start loading data when page loads
loadObservationsOnMap();

// ============================================================================
// MAP VIEW DATA MANAGEMENT - Download/Upload functionality
// ============================================================================

// Helper to escape HTML
function escapeHtml(text) {
    if (!text) return '';
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
    return text.replace(/[&<>"']/g, c => map[c]);
}

// ============================================================================
// DATA PANEL POPUP FUNCTIONS
// (See data-panel-popups.js for popup management functions)
// ============================================================================

// Helper to show error messages
function showMapError(message) {
    const el = document.getElementById('mapError');
    if (el) {
        el.textContent = message;
        el.style.display = 'block';
        setTimeout(() => { el.style.display = 'none'; }, 4000);
    }
}



// Fetch data from Laji.fi URL
async function fetchDataForMap() {
    const url = (document.getElementById('lajifiUrlInput') || {}).value || '';
    if (!url.trim()) { 
        const progressDiv = document.getElementById('lajifiProgress');
        const progressLog = document.getElementById('lajifiProgressLog');
        if (progressDiv) {
            progressDiv.style.display = 'block';
            progressDiv.classList.add('lajifi-progress-error');
        }
        if (progressLog) {
            progressLog.innerHTML = '';
            addProgressLog('Virhe: Syötä URL-osoite', 'error', progressLog);
        }
        return; 
    }

    const progressDiv = document.getElementById('lajifiProgress');
    const progressLog = document.getElementById('lajifiProgressLog');
    if (progressDiv) {
        progressDiv.style.display = 'block';
        progressDiv.classList.remove('lajifi-progress-error');
    }
    if (progressLog) progressLog.innerHTML = '';

    // Clear any previous error state
    window.currentFetchedData = null;
    const saveSectionBtn = document.querySelector('.btn-lajifi-save');
    if (saveSectionBtn) saveSectionBtn.disabled = false;

    try {
        await window.parseUrl(url, progressLog);
        const saveSection = document.getElementById('lajifiSaveSection');
        if (saveSection) saveSection.style.display = 'block';
    } catch (err) {
        // Mark progress section as error state
        if (progressDiv) progressDiv.classList.add('lajifi-progress-error');
        // Disable save button on error
        if (saveSectionBtn) saveSectionBtn.disabled = true;
        // Clear fetched data to prevent saving
        window.currentFetchedData = null;
        // Add error message directly to progress log
        if (progressLog) {
            addProgressLog('Virhe: ' + err.message, 'error', progressLog);
        }
    }
}

// Generate unique ID for dataset
function generateMapDatasetId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

// Save fetched data to database
async function saveDataForMap() {
    if (!window.currentFetchedData) {
        const progressDiv = document.getElementById('lajifiProgress');
        const progressLog = document.getElementById('lajifiProgressLog');
        if (progressDiv) {
            progressDiv.style.display = 'block';
            progressDiv.classList.add('lajifi-progress-error');
        }
        if (progressLog) {
            addProgressLog('Virhe: Ei tallennettavaa dataa. Hae data ensin.', 'error', progressLog);
        }
        return;
    }
    const currentApiUrl = window.currentFetchedUrl || '';

    try {
        const resp = await fetch('/api/observations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                mx_id: datasetId,
                dataset_id: generateMapDatasetId(),
                dataset_name: `Dataset ${new Date().toLocaleString()}`,
                dataset_url: currentApiUrl,
                features: window.currentFetchedData.features
            })
        });
        const result = await resp.json();
        if (result.success) {
            showMapError(`✓ Aineisto tallennettu! ${result.count} havaintoa.`);
            document.getElementById('lajifiUrlInput').value = '';
            const saveSection = document.getElementById('lajifiSaveSection');
            if (saveSection) saveSection.style.display = 'none';
            const progressDiv = document.getElementById('lajifiProgress');
            if (progressDiv) progressDiv.style.display = 'none';
            window.currentFetchedData = null;
            window.currentFetchedUrl = null;
            // Reload observations on the map without refreshing the page
            await reloadMapObservations();
            // Refresh legend after data changes
            if (typeof window.refreshDatasetLegend === 'function') {
                await window.refreshDatasetLegend();
            }
            setTimeout(() => closePopup(), 1500);
        } else {
            const progressDiv = document.getElementById('lajifiProgress');
            const progressLog = document.getElementById('lajifiProgressLog');
            if (progressDiv) {
                progressDiv.style.display = 'block';
                progressDiv.classList.add('lajifi-progress-error');
            }
            if (progressLog) addProgressLog('Virhe: Tallennus epäonnistui - ' + result.error, 'error', progressLog);
        }
    } catch (err) {
        console.error('Error saving data:', err);
        const progressDiv = document.getElementById('lajifiProgress');
        const progressLog = document.getElementById('lajifiProgressLog');
        if (progressDiv) {
            progressDiv.style.display = 'block';
            progressDiv.classList.add('lajifi-progress-error');
        }
        if (progressLog) addProgressLog('Virhe: Tallennus epäonnistui - ' + err.message, 'error', progressLog);
    }    // Refresh legend after data changes
    if (typeof window.refreshDatasetLegend === 'function') {
        await window.refreshDatasetLegend();
    }}

// Upload CSV file
async function uploadCsvForMap() {
    const fileInput = document.getElementById('csvFileInput');
    if (!fileInput || !fileInput.files.length) {
        const progressDiv = document.getElementById('csvProgress');
        const progressLog = document.getElementById('csvProgressLog');
        if (progressDiv) {
            progressDiv.style.display = 'block';
            progressDiv.classList.add('csv-progress-error');
        }
        if (progressLog) {
            progressLog.innerHTML = '';
            addProgressLog('Virhe: Valitse CSV-tiedosto', 'error', progressLog);
        }
        return;
    }
    const form = new FormData();
    form.append('file', fileInput.files[0]);

    const progressDiv = document.getElementById('csvProgress');
    const progressLog = document.getElementById('csvProgressLog');
    if (progressDiv) {
        progressDiv.style.display = 'block';
        progressDiv.classList.remove('csv-progress-error');
    }
    if (progressLog) progressLog.innerHTML = '<div>Ladataan...</div>';

    try {
        const resp = await fetch(`/api/taxons/${datasetId}/upload_csv`, {
            method: 'POST',
            body: form
        });
        const result = await resp.json();
        if (result.success) {
            if (progressLog) progressLog.innerHTML += `<div style="color:green;">✓ Ladattu ${result.count} havaintoa</div>`;
            if (progressLog) addProgressLog(`✓ Ladattu ${result.count} havaintoa`, 'success', progressLog);
            fileInput.value = '';
            document.getElementById('csvPreview').style.display = 'none';
            // Reload observations on the map without refreshing the page
            await reloadMapObservations();
            // Refresh legend after data changes
            if (typeof window.refreshDatasetLegend === 'function') {
                await window.refreshDatasetLegend();
            }
            setTimeout(() => closePopup(), 1500);
        } else {
            if (progressDiv) progressDiv.classList.add('csv-progress-error');
            if (progressLog) addProgressLog('Virhe: ' + result.error, 'error', progressLog);
        }
    } catch (err) {
        console.error('Upload error:', err);
        if (progressDiv) progressDiv.classList.add('csv-progress-error');
        if (progressLog) addProgressLog('Virhe: Lähetys epäonnistui - ' + err.message, 'error', progressLog);
    }
}

// Delete dataset
async function deleteMapDataset(datasetIdStr) {
    if (!await window.mapDialogs.confirm('Haluatko varmasti poistaa tämän aineiston?')) return;

    try {
        const resp = await fetch(`/api/taxons/${datasetId}/datasets/${datasetIdStr}`, { method: 'DELETE' });
        const result = await resp.json();
        if (result.success) {
            showMapError('✓ Aineisto poistettu');
            // Reload observations on the map without refreshing the page
            await reloadMapObservations();
            // Refresh legend after deletion
            if (typeof window.refreshDatasetLegend === 'function') {
                await window.refreshDatasetLegend();
            }
        } else {
            showMapError('Poisto epäonnistui: ' + result.error);
        }
    } catch (err) {
        console.error('Error deleting dataset:', err);
        showMapError('Poisto epäonnistui');
    }
}
