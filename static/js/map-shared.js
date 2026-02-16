/* global L */

// Shared map utilities for handling geometries

// Create a shared Leaflet map and helper objects. Returns an object with
// `{ map, geometryLayer, stats, updateStatus }`.
window.createSharedMap = function(containerId = 'map', center = [60.1699, 24.9384], zoom = 6) {
    const map = L.map(containerId).setView(center, zoom);

    // Add default basemap (OpenStreetMap)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 19
    }).addTo(map);

    const geometryLayer = L.featureGroup().addTo(map);

    // Expose map and geometry layer globally so other helpers can access them
    window.sharedMap = map;
    window.sharedGeometryLayer = geometryLayer;

    const stats = {
        total: 0,
        skipped: 0
    };

    function updateStatus(msg) {
        const el = document.getElementById('status');
        if (el) el.textContent = msg;
    }

    // Setup multi-feature click handler
    setupMultiFeatureHandler(map, geometryLayer);

    // Setup polygon selector and bulk enable/disable controls
    try { setupPolygonSelector(map, geometryLayer); } catch (e) { console.warn('Polygon selector initialization failed:', e); }

    // Initialize dataset layers mapping and attempt to create the legend control
    window.datasetLayers = window.datasetLayers || {}; // dataset_id -> { group: L.LayerGroup, name, count }
    try { if (typeof window.createLegendControl === 'function') { window.createLegendControl(); } } catch (e) { console.warn('Legend control initialization failed:', e); }

    return { map, geometryLayer, stats, updateStatus };
};

// Set exclude status to a specific value (true/false) for an observation ID
// This now delegates to the efficient batch path so updates happen in a single-pass
window.setExclude = async function(obsId, excluded) {
    try {
        if (!obsId) return { success: false, error: 'no-id' };
        // Use batch function for consistent, efficient updates
        const res = await window.setExcludeBatch([obsId], excluded, 100);
        if (!res || typeof res.processed !== 'number') {
            return { success: false, error: 'batch-failed' };
        }
        const success = res.processed > 0;
        // Ensure legend sync was attempted
        if (typeof window.syncLegendWithFeatures === 'function') {
            try { window.syncLegendWithFeatures(); } catch (e) { console.warn('Legend sync failed:', e); }
        }
        return { success, excluded: !!excluded };
    } catch (e) {
        console.error('Error setting exclude:', e);
        return { success: false, error: e && e.message };
    }
}

// Batch set exclude for many observation IDs. Sends requests in parallel chunks
// and applies the same layer update logic as `window.setExclude` for each
// successful response. Returns a summary {processed, failed}.
window.setExcludeBatch = async function(obsIds, excluded, batchSize = 100) {
    if (!Array.isArray(obsIds) || obsIds.length === 0) return { processed: 0, failed: 0 };
    const ids = obsIds.map(id => String(id));
    let processed = 0;
    let failed = 0;
    const updatedIdsAll = [];

    // Process in sequential chunks to avoid overly large payloads
    for (let i = 0; i < ids.length; i += batchSize) {
        const chunk = ids.slice(i, i + batchSize);
        try {
            const res = await fetch('/api/observations/exclude', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ids: chunk, excluded: !!excluded })
            });

            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                console.error('Batch exclude chunk failed:', err.error || res.statusText || 'request-failed');
                failed += chunk.length;
                continue;
            }

            const data = await res.json().catch(() => ({}));
            const updated = Array.isArray(data.updated_ids) ? data.updated_ids.map(String) : [];
            const proc = typeof data.processed === 'number' ? data.processed : updated.length;
            const fail = typeof data.failed === 'number' ? data.failed : (chunk.length - proc);
            processed += proc;
            failed += fail;
            updated.forEach(id => updatedIdsAll.push(String(id)));
        } catch (e) {
            console.error('Error in batch exclude request:', e);
            failed += chunk.length;
        }
    }

    // Single-pass update of map layers and grid features using all updated ids
    try {
        if (Array.isArray(updatedIdsAll) && updatedIdsAll.length > 0) {
            const updatedSet = new Set(updatedIdsAll.map(String));

            if (window.sharedGeometryLayer && typeof window.sharedGeometryLayer.eachLayer === 'function') {
                window.sharedGeometryLayer.eachLayer(function(layer) {
                    const props = (layer.feature && layer.feature.properties) || layer.feature || {};
                    const layerDbId = props._db_id || props.db_id;
                    if (layerDbId && updatedSet.has(String(layerDbId))) {
                        props.excluded = !!excluded;
                        try {
                            const el = (typeof layer.getElement === 'function') ? layer.getElement() : null;
                            if (el && el.classList) {
                                el.classList.toggle('geom-excluded', !!excluded);
                                el.classList.toggle('geom-included', !excluded);
                            }
                        } catch (e) { /* ignore styling errors */ }
                    }
                });
            }

            if (window.sharedGridFeatures && Array.isArray(window.sharedGridFeatures)) {
                window.sharedGridFeatures.forEach(f => {
                    const fId = f && f.properties && (f.properties._db_id || f.properties.db_id);
                    if (fId && updatedSet.has(String(fId))) {
                        f.properties = f.properties || {};
                        f.properties.excluded = !!excluded;
                    }
                });
            }
        }
    } catch (e) {
        console.error('Error updating layer styles after batch exclude:', e);
    }

    // Recalculate grid and sync legend once after all updates
    if (typeof window.recalculateGrid === 'function') { try { window.recalculateGrid(); } catch (e) { /* ignore */ } }
    if (typeof window.syncLegendWithFeatures === 'function') {
        try { window.syncLegendWithFeatures(); } catch (e) { console.warn('Legend sync failed:', e); }
    }

    return { processed, failed };
}

// Generic paginated observations fetcher. Calls `perFeature(feature)` for
// each feature and `onComplete(meta)` once all pages are processed. Expects
// an `updateStatus` function to display progress.
window.fetchAllObservationsGeneric = async function(datasetId, perFeature, updateStatus, onComplete) {
    updateStatus('Loading observations...');
    try {
        const firstResponse = await fetch(`/api/observations/${datasetId}?page=1&per_page=1000&`);
        if (!firstResponse.ok) throw new Error(`HTTP error! status: ${firstResponse.status}`);
        const firstData = await firstResponse.json();

        if (!firstData.features || firstData.features.length === 0) {
            updateStatus('No observations found for this dataset');
            return;
        }

        // Dataset name may be returned at top-level (`dataset_name`) or inside feature properties.
        const datasetName = firstData.dataset_name || 'Unknown Dataset';

        const totalPages = (firstData.pagination && firstData.pagination.pages) || 1;
        const total = (firstData.pagination && firstData.pagination.total) || firstData.features.length;

        updateStatus(`Loading ${datasetName} (page 1 of ${totalPages})...`);

        firstData.features.forEach(f => perFeature(f));

        // If there are more pages, fetch them with a limited concurrency to avoid flooding the server/browser.
        if (totalPages > 1) {
            const pages = [];
            for (let p = 2; p <= totalPages; p++) pages.push(p);

            const concurrency = 5; // Tunable: number of parallel page fetches
            let idx = 0;
            const workers = Array.from({ length: Math.min(concurrency, pages.length) }, async () => {
                while (true) {
                    let p;
                    // Fetch next page index atomically
                    p = pages[idx++];
                    if (typeof p === 'undefined') break;

                    try {
                        updateStatus(`Loading ${datasetName} (page ${p} of ${totalPages})...`);
                        const res = await fetch(`/api/observations/${datasetId}?page=${p}&per_page=1000`);
                        if (!res.ok) {
                            console.warn(`Page ${p} fetch failed with status ${res.status}`);
                            continue;
                        }
                        const data = await res.json();
                        if (data && data.features && Array.isArray(data.features)) {
                            data.features.forEach(f => perFeature(f));
                        }
                    } catch (e) {
                        console.error(`Failed to fetch page ${p}:`, e);
                    }
                }
            });

            await Promise.all(workers);
        }

        if (typeof onComplete === 'function') {
            onComplete({ datasetName, totalPages, total });
        }
    } catch (err) {
        console.error('Error fetching observations:', err);
        updateStatus(`Error loading data: ${err.message}`);
    }
};

// Function to create geometry layers without adding to map (for batch processing)
// Returns the created layer(s) or array of layers
window.createGeometryLayers = function(geometry, properties) {
    if (!geometry || !geometry.type) return null;

    const popupContent = createPopupContent(properties || {});
    const excluded = properties && (properties.excluded === true || properties.excluded === '1' || properties.excluded === 1);
    const className = excluded ? 'geom-excluded' : 'geom-included';

    function createLayer(geom) {
        if (geom.type === 'Point') {
            const lat = geom.coordinates[1], lon = geom.coordinates[0];
            const marker = L.circleMarker([lat, lon], {
                radius: 7,
                className: className,
                weight: 1,
                opacity: 1,
                fillOpacity: 0.8
            });
            marker.feature = marker.feature || {};
            marker.feature.properties = properties || {};
            marker.feature.geometry = geom;
            try { addToDataset(marker, properties); } catch (e) {}
            return marker;
        } else if (geom.type === 'LineString') {
            const latLngs = geom.coordinates.map(c => [c[1], c[0]]);
            const line = L.polyline(latLngs, { className: className, weight: 7, opacity: 0.8 });
            line.bindPopup(popupContent);
            line.feature = line.feature || {};
            line.feature.properties = properties || {};
            line.feature.geometry = geom;
            try { addToDataset(line, properties); } catch (e) {}
            return line;
        } else if (geom.type === 'Polygon') {
            const latLngs = geom.coordinates.map(ring => ring.map(c => [c[1], c[0]]));
            const poly = L.polygon(latLngs, { className: className, weight: 2, opacity: 0.8, fillOpacity: 0.3 });
            poly.bindPopup(popupContent);
            poly.feature = poly.feature || {};
            poly.feature.properties = properties || {};
            poly.feature.geometry = geom;
            try { addToDataset(poly, properties); } catch (e) {}
            return poly;
        } else if (geom.type === 'MultiPoint' || geom.type === 'MultiLineString' || geom.type === 'MultiPolygon') {
            const subType = geom.type.replace('Multi', '');
            const layers = [];
            if (geom.coordinates && Array.isArray(geom.coordinates)) {
                geom.coordinates.forEach(coords => {
                    const subLayer = createLayer({ type: subType, coordinates: coords });
                    if (subLayer) layers.push(subLayer);
                });
            }
            return layers;
        } else if (geom.type === 'GeometryCollection' && geom.geometries && Array.isArray(geom.geometries)) {
            const layers = [];
            geom.geometries.forEach(g => {
                const subLayer = createLayer(g);
                if (subLayer) {
                    if (Array.isArray(subLayer)) layers.push(...subLayer);
                    else layers.push(subLayer);
                }
            });
            return layers;
        }
        return null;
    }

    return createLayer(geometry);
};

// Toggle excluded flag for an observation by DB id. Button element passed as `btn`.
// Uses `setExclude` (which routes through the efficient batch path) and only updates UI
window.toggleExclude = async function(obsId, btn) {
    try {
        if (!obsId) return;
        const current = btn.getAttribute('data-excluded') === '1';
        const newValue = !current;

        const data = await window.setExclude(obsId, newValue);
        if (!data || !data.success) {
            alert('Failed to update: ' + (data && data.error ? data.error : 'unknown error'));
            return;
        }

        // Update button state
        btn.setAttribute('data-excluded', data.excluded ? '1' : '0');
        btn.textContent = data.excluded ? 'Include in analysis' : 'Exclude from analysis';

        // If a multi-feature popup is open, update its entry class and stored properties
        try {
            if (window._currentMultiFeatures && Array.isArray(window._currentMultiFeatures)) {
                for (let i = 0; i < window._currentMultiFeatures.length; i++) {
                    const f = window._currentMultiFeatures[i];
                    const fId = f && f.properties && (f.properties._db_id || f.properties.db_id);
                    if (fId && String(fId) === String(obsId)) {
                        f.properties = f.properties || {};
                        f.properties.excluded = data.excluded;
                        const item = document.querySelector(`.multi-feature-popup .feature-item[data-feature-index="${i}"]`);
                        if (item) {
                            if (data.excluded) item.classList.add('excluded-feature'); else item.classList.remove('excluded-feature');
                        }
                        break;
                    }
                }
            }
        } catch (e) { /* ignore */ }

        // Note: the actual layer styling and legend sync have already been handled by setExcludeBatch
    } catch (e) {
        console.error('Error toggling exclude:', e);
        alert('Error toggling exclude: ' + e.message);
    }
};

// Helper: sanitize DOM id for dataset entry
function sanitizeDomId(s) {
    return 'ds-' + String(s || '').replace(/[^a-z0-9_-]/ig, '_');
}

// Update legend checkbox state based on actual feature exclusion state
// A dataset checkbox should be checked (enabled) only if at least one feature is included (not excluded)
window.syncLegendWithFeatures = function() {
    if (!window.datasetLayers) return;
    
    for (const dsId in window.datasetLayers) {
        const entry = window.datasetLayers[dsId];
        if (!entry || !entry.group) continue;
        
        let hasIncludedFeatures = false;
        let totalFeatures = 0;
        let includedFeatures = 0;
        
        // Check all layers in this dataset
        try {
            entry.group.eachLayer(function(layer) {
                totalFeatures++;
                const props = (layer.feature && layer.feature.properties) || layer.feature || {};
                const excluded = props.excluded === true || props.excluded === '1' || props.excluded === 1;
                if (!excluded) {
                    hasIncludedFeatures = true;
                    includedFeatures++;
                }
            });
        } catch (e) {
            console.warn('Error checking layers for dataset', dsId, e);
        }
        
        // Update the legend checkbox without triggering change event
        const safe = sanitizeDomId(dsId);
        const checkbox = document.getElementById('legend-cb-' + safe);
        if (checkbox && totalFeatures > 0) {
            const shouldBeChecked = hasIncludedFeatures;
            if (checkbox.checked !== shouldBeChecked) {
                // Temporarily disable to prevent change event
                const changeHandler = checkbox.onchange;
                checkbox.onchange = null;
                checkbox.checked = shouldBeChecked;
                checkbox.onchange = changeHandler;
            }
        }
        
        // Update the count display to show included/total
        const countEl = document.getElementById('legend-count-' + safe);
        if (countEl) {
            countEl.textContent = `${includedFeatures}/${totalFeatures}`;
        }
    }
};

// Ensure dataset layer exists and return it
function ensureDatasetLayer(dsId, dsName) {
    window.datasetLayers = window.datasetLayers || {};
    if (!window.datasetLayers[dsId]) {
        const g = L.layerGroup().addTo(window.sharedMap);
        window.datasetLayers[dsId] = { group: g, name: dsName || dsId, count: 0 };
    }
    return window.datasetLayers[dsId];
}

// Add a created Leaflet layer to the dataset group and update counts/UI
function addToDataset(layer, properties) {
    try {
        const dsId = (properties && (properties._dataset_id || properties.dataset_id)) || 'unknown';
        const dsName = (properties && (properties.dataset_name || properties.dataset_name)) || dsId;
        const dsEntry = ensureDatasetLayer(dsId, dsName);
        dsEntry.group.addLayer(layer);
        dsEntry.count = (dsEntry.count || 0) + 1;
        const countEl = document.getElementById('legend-count-' + sanitizeDomId(dsId));
        if (countEl) countEl.textContent = dsEntry.count;
    } catch (e) {
        console.warn('addToDataset error', e);
    }
}

// Toggle exclude for all observations in a dataset (by dataset id)
window.toggleDatasetExclude = async function(dsid, exclude) {
    if (!dsid) throw new Error('No dataset id');
    window._datasetTogglePending = window._datasetTogglePending || {};
    if (window._datasetTogglePending[dsid]) throw new Error('Operation already in progress');
    const entry = window.datasetLayers && window.datasetLayers[dsid];
    if (!entry) throw new Error('Dataset not found');

    // Gather DB ids from dataset group's layers
    const ids = [];
    try {
        entry.group.eachLayer(function(layer) {
            const props = (layer.feature && layer.feature.properties) || layer.feature || {};
            const id = props && (props._db_id || props.db_id);
            if (id) ids.push(id);
        });
    } catch (e) {
        console.error('Error gathering IDs for dataset', dsid, e);
    }

    if (!ids.length) throw new Error('No DB-backed features in dataset');

    window._datasetTogglePending[dsid] = true;
    try {
        const res = await window.setExcludeBatch(ids, exclude);
        // After batch operation, legend sync is already called by setExcludeBatch
        // But also explicitly update this specific checkbox to ensure it reflects the operation
        const safe = sanitizeDomId(dsid);
        const checkbox = document.getElementById('legend-cb-' + safe);
        if (checkbox) {
            // If we excluded all, checkbox should be unchecked; if we included all, it should be checked
            const shouldBeChecked = !exclude;
            if (checkbox.checked !== shouldBeChecked) {
                const changeHandler = checkbox.onchange;
                checkbox.onchange = null;
                checkbox.checked = shouldBeChecked;
                checkbox.onchange = changeHandler;
            }
        }
        return res;
    } finally {
        window._datasetTogglePending[dsid] = false;
    }
};