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
            
            // Update grid creation timestamp
            const aooTimeEl = document.getElementById('aoo_calculated_at');
            if (aooTimeEl && data.created_at) {
                aooTimeEl.textContent = formatIsoTimestamp(data.created_at);
            }
        } else {
            window.sharedGridFeatures = [];
            document.getElementById('cellsCount').textContent = '0';
        }
    } catch (error) {
        console.error('Error fetching grid:', error);
        updateStatus(`Virhe: ${error.message}`);
        document.getElementById('cellsCount').textContent = 'Virhe';
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

// Load datasets for this species from the backend
async function loadMapDatasets() {
    const container = document.getElementById('mapDatasets');
    if (!container) return;
    try {
        const resp = await fetch(`/api/taxons/${datasetId}/datasets`);
        const data = await resp.json();
        displayMapDatasets(data.datasets || [], container);
    } catch (err) {
        console.error('Error loading datasets:', err);
        container.innerHTML = '<p>Aineistojen lataus epäonnistui</p>';
    }
}

function displayMapDatasets(datasets, container) {
    if (datasets.length === 0) {
        container.innerHTML = '<p style="color:#999; font-size:12px;">Ei vielä aineistoja.</p>';
        return;
    }
    let html = '<div style="border: 1px solid #ddd; border-radius: 3px; padding: 8px; font-size: 12px;">';
    for (const ds of datasets) {
        html += `
        <div style="margin-bottom: 8px; padding-bottom: 8px; border-bottom: 1px solid #eee;">
            <div><strong>${escapeHtml(ds.dataset_name || 'Nimetön')}</strong></div>
            <div style="color: #666; font-size: 11px;">Havainnot: ${ds.count}</div>
            <div style="color: #666; font-size: 11px;">Lisätty: ${new Date(ds.created_at).toLocaleString()}</div>
            <div style="margin-top: 4px; display: flex; gap: 4px;">
                <button onclick="downloadMapDataset('${ds.dataset_id}')" style="padding: 4px 8px; background: #007bff; color: white; border: none; border-radius: 3px; cursor: pointer; font-size: 11px;">Lataa</button>
                ${ds.dataset_url ? `<button onclick="reloadMapDataset('${ds.dataset_id}', '${encodeURIComponent(ds.dataset_url)}')" style="padding: 4px 8px; background: #17a2b8; color: white; border: none; border-radius: 3px; cursor: pointer; font-size: 11px;">Päivitä</button>` : ''}
                <button onclick="deleteMapDataset('${ds.dataset_id}')" style="padding: 4px 8px; background: #dc3545; color: white; border: none; border-radius: 3px; cursor: pointer; font-size: 11px;">Poista</button>
            </div>
        </div>`;
    }
    html += '</div>';
    container.innerHTML = html;
}

// Fetch data from Laji.fi URL
async function fetchDataForMap() {
    const url = (document.getElementById('lajifiUrlInput') || {}).value || '';
    if (!url.trim()) { 
        showMapError('Syötä URL-osoite'); 
        return; 
    }

    const progressDiv = document.getElementById('lajifiProgress');
    const progressLog = document.getElementById('lajifiProgressLog');
    if (progressDiv) progressDiv.style.display = 'block';
    if (progressLog) progressLog.innerHTML = '';

    try {
        await window.parseUrl(url, progressLog);
        const saveSection = document.getElementById('lajifiSaveSection');
        if (saveSection) saveSection.style.display = 'block';
    } catch (err) {
        showMapError('Haun suoritus epäonnistui: ' + err.message);
    }
}

// Generate unique ID for dataset
function generateMapDatasetId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

// Save fetched data to database
async function saveDataForMap() {
    if (!window.currentFetchedData) {
        showMapError('Ei tallennettavaa dataa. Hae data ensin.');
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
            await loadMapDatasets();
            setTimeout(() => closePopup(), 1500);
        } else {
            showMapError('Tallennus epäonnistui: ' + result.error);
        }
    } catch (err) {
        console.error('Error saving data:', err);
        showMapError('Tallennus epäonnistui');
    }
}

// Upload CSV file
async function uploadCsvForMap() {
    const fileInput = document.getElementById('csvFileInput');
    if (!fileInput || !fileInput.files.length) {
        showMapError('Valitse CSV-tiedosto');
        return;
    }
    const form = new FormData();
    form.append('file', fileInput.files[0]);

    const progressDiv = document.getElementById('csvProgress');
    const progressLog = document.getElementById('csvProgressLog');
    if (progressDiv) progressDiv.style.display = 'block';
    if (progressLog) progressLog.innerHTML = '<div>Ladataan...</div>';

    try {
        const resp = await fetch(`/api/taxons/${datasetId}/upload_csv`, {
            method: 'POST',
            body: form
        });
        const result = await resp.json();
        if (result.success) {
            if (progressLog) progressLog.innerHTML += `<div style="color:green;">✓ Ladattu ${result.count} havaintoa</div>`;
            showMapError(`✓ Ladattu ${result.count} havaintoa`);
            fileInput.value = '';
            document.getElementById('csvPreview').style.display = 'none';
            setTimeout(() => closePopup(), 1500);
            await loadMapDatasets();
        } else {
            if (progressLog) progressLog.innerHTML += `<div style="color:red;">✗ Virhe: ${result.error}</div>`;
            showMapError('Lataus epäonnistui: ' + result.error);
        }
    } catch (err) {
        console.error('Upload error:', err);
        if (progressLog) progressLog.innerHTML += `<div style="color:red;">✗ Lähetys epäonnistui</div>`;
        showMapError('Lähetys epäonnistui');
    }
}

// Download dataset as CSV
async function downloadMapDataset(datasetIdStr) {
    try {
        const resp = await fetch(`/api/taxons/${datasetId}/download_csv?dataset_id=${encodeURIComponent(datasetIdStr)}`);
        if (!resp.ok) {
            const err = await resp.json();
            showMapError('Lataus epäonnistui: ' + (err.error || resp.statusText));
            return;
        }
        const blob = await resp.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `dataset_${datasetIdStr}.csv`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
        showMapError('✓ Aineisto ladattu');
    } catch (err) {
        console.error('Download error:', err);
        showMapError('Lataus epäonnistui');
    }
}

// Reload dataset from URL
async function reloadMapDataset(datasetIdStr, encodedUrl) {
    try {
        const url = decodeURIComponent(encodedUrl || '');
        if (!url) { 
            showMapError('Ei lähde-URL-osoitetta'); 
            return; 
        }
        if (!confirm('Uudelleenlataus korvaa olemassa olevan aineiston. Jatketaanko?')) return;

        const progressDiv = document.getElementById('mapFetchProgress');
        const progressLog = document.getElementById('mapProgressLog');
        if (progressDiv && progressLog) {
            progressDiv.style.display = 'block';
            progressLog.innerHTML = '';
        }

        await window.parseUrl(url, progressLog);

        // Save the reloaded data with same dataset ID
        if (!window.currentFetchedData) {
            showMapError('Haun suoritus epäonnistui.');
            return;
        }

        try {
            const resp = await fetch('/api/observations', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    mx_id: datasetId,
                    dataset_id: datasetIdStr,  // Reuse existing dataset ID
                    dataset_name: `Dataset ${new Date().toLocaleString()}`,
                    dataset_url: url,
                    features: window.currentFetchedData.features,
                    replace_existing: true
                })
            });
            const result = await resp.json();
            if (result.success) {
                showMapError(`✓ Aineisto päivitetty! ${result.count} havaintoa.`);
                const progressDiv = document.getElementById('mapFetchProgress');
                if (progressDiv) progressDiv.style.display = 'none';
                window.currentFetchedData = null;
                window.currentFetchedUrl = null;
                await loadMapDatasets();
            } else {
                showMapError('Päivitys epäonnistui: ' + result.error);
            }
        } catch (err) {
            console.error('Error updating dataset:', err);
            showMapError('Päivitys epäonnistui');
        }
    } catch (e) {
        showMapError('Virheellinen URL');
    }
}

// Delete dataset
async function deleteMapDataset(datasetIdStr) {
    if (!confirm('Haluatko varmasti poistaa tämän aineiston?')) return;

    try {
        const resp = await fetch(`/api/taxons/${datasetId}/datasets/${datasetIdStr}`, { method: 'DELETE' });
        const result = await resp.json();
        if (result.success) {
            showMapError('✓ Aineisto poistettu');
            await loadMapDatasets();
        } else {
            showMapError('Poisto epäonnistui: ' + result.error);
        }
    } catch (err) {
        console.error('Error deleting dataset:', err);
        showMapError('Poisto epäonnistui');
    }
}
// Initialize datasets when page loads
window.addEventListener('load', () => {
    loadMapDatasets();
});
