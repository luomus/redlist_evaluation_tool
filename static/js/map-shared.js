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
    
    // Initialize biogeographical regions layer from local GeoJSON file
    window.bioRegionsLayer = L.geoJSON(null, {
        style: {
            color: '#ff7800',
            weight: 2,
            opacity: 0.6,
            dashArray: '5,5',
            fill: false
        },
        onEachFeature: function(feature, layer) {
            if (feature.properties && feature.properties.name) {
                layer.bindPopup(feature.properties.name);
            }
        }
    });
    window.bioRegionsVisible = false;
    
    // Load biogeographical regions data from local file
    fetch('/static/resources/biogeographicalProvinces.json')
        .then(r => {
            console.log('Biogeographical regions fetch response:', r.status, r.statusText);
            if (!r.ok) throw new Error(`HTTP ${r.status}: ${r.statusText}`);
            return r.json();
        })
        .then(data => {
            console.log('Biogeographical regions data loaded:', data);
            if (data && data.features && data.features.length > 0) {
                console.log(`Adding ${data.features.length} biogeographical regions to map`);
                window.bioRegionsLayer.addData(data);
            } else {
                console.warn('No features found in biogeographical regions data');
            }
        })
        .catch(err => {
            console.error('Failed to load biogeographical regions:', err);
        });
    
    try { if (typeof window.createLegendControl === 'function') { window.createLegendControl(); } } catch (e) { console.warn('Legend control initialization failed:', e); }

    // Add scale bar to bottom-left corner
    L.control.scale({ position: 'bottomleft' }).addTo(map);

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
                                // remove any existing accuracy-related classes so we can re-add correct one
                                el.classList.remove('accuracy-1-10','accuracy-11-100','accuracy-101-1000','accuracy-1001-10000','accuracy-10001-100000');

                                if (excluded) {
                                    // excluded state overrides accuracy colouring
                                    el.classList.add('geom-excluded');
                                    el.classList.remove('geom-included');

                                    // ensure grey styling persists
                                    el.setAttribute('stroke', '#888888');
                                    el.setAttribute('fill', '#acacac');
                                } else {
                                    el.classList.remove('geom-excluded');

                                    const accClass = window.getAccuracyClass(props && props['gathering.interpretations.coordinateAccuracy']);
                                    if (accClass) {
                                        el.classList.add(accClass);
                                        // clear any explicit attributes so CSS handles color
                                        el.removeAttribute('stroke');
                                        el.removeAttribute('fill');
                                    } else {
                                        el.classList.add('geom-included');
                                        el.setAttribute('stroke', '#940000');
                                        el.setAttribute('fill', '#cc4141');
                                    }
                                }
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
    updateStatus('Ladataan havaintoja...');
    try {
        const firstResponse = await fetch(`/api/observations/${datasetId}?page=1&per_page=1000&`);
        if (!firstResponse.ok) throw new Error(`HTTP error! status: ${firstResponse.status}`);
        const firstData = await firstResponse.json();

        if (!firstData.features || firstData.features.length === 0) {
            updateStatus('Tälle aineistolle ei löytynyt havaintoja');
            return;
        }

        // Dataset name may be returned at top-level (`dataset_name`) or inside feature properties.
        const datasetName = firstData.dataset_name || 'Tuntematon aineisto';

        const totalPages = (firstData.pagination && firstData.pagination.pages) || 1;
        const total = (firstData.pagination && firstData.pagination.total) || firstData.features.length;

        updateStatus(`Ladataan ${datasetName} (sivu 1 / ${totalPages})...`);

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
                        updateStatus(`Ladataan ${datasetName} (sivu ${p} / ${totalPages})...`);
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
        updateStatus(`Virhe ladattaessa aineistoa: ${err.message}`);
    }
};

// Helper function: determine accuracy class from coordinateAccuracy value (in meters)
// Classes: 1-10m, 11-100m, 101-1000m, 1001-10000m, 10001-100000m
window.getAccuracyClass = function(coordinateAccuracy) {
    if (!coordinateAccuracy) return null;
    
    const accuracy = parseFloat(coordinateAccuracy);
    if (isNaN(accuracy)) return null;
    
    if (accuracy <= 10) return 'accuracy-1-10';
    if (accuracy <= 100) return 'accuracy-11-100';
    if (accuracy <= 1000) return 'accuracy-101-1000';
    if (accuracy <= 10000) return 'accuracy-1001-10000';
    if (accuracy <= 100000) return 'accuracy-10001-100000';
    
    return null;
};

// Compute centroid [lat, lng] of a GeoJSON Polygon or MultiPolygon geometry
window.polygonCentroid = function(geometry) {
    let coords = [];
    if (geometry.type === 'Polygon') {
        coords = geometry.coordinates[0] || [];
    } else if (geometry.type === 'MultiPolygon') {
        geometry.coordinates.forEach(poly => {
            (poly[0] || []).forEach(c => coords.push(c));
        });
    }
    if (!coords.length) return { lat: 0, lng: 0 };
    let sumLng = 0, sumLat = 0;
    coords.forEach(c => { sumLng += c[0]; sumLat += c[1]; });
    return { lat: sumLat / coords.length, lng: sumLng / coords.length };
};

// Ray-casting point-in-polygon test. point = [lng, lat], ring = [[lng,lat], ...]
window.pointInPolygonRing = function(point, ring) {
    const x = point[0], y = point[1];
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const xi = ring[i][0], yi = ring[i][1];
        const xj = ring[j][0], yj = ring[j][1];
        const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
};

// Check whether point [lng, lat] is inside a GeoJSON Polygon or MultiPolygon geometry
window.pointInPolygonGeometry = function(point, geometry) {
    if (!geometry) return false;
    if (geometry.type === 'Polygon') {
        return window.pointInPolygonRing(point, geometry.coordinates[0] || []);
    } else if (geometry.type === 'MultiPolygon') {
        for (const poly of geometry.coordinates) {
            if (window.pointInPolygonRing(point, poly[0] || [])) return true;
        }
        return false;
    }
    return false;
};

// Function to create geometry layers without adding to map (for batch processing)
// Returns the created layer(s) or array of layers
window.createGeometryLayers = function(geometry, properties) {
    if (!geometry || !geometry.type) return null;

    const popupContent = createPopupContent(properties || {});
    const excluded = properties && (properties.excluded === true || properties.excluded === '1' || properties.excluded === 1);
    
    // Determine class based on coordinate accuracy (prioritize accuracy over excluded status)
    let className = excluded ? 'geom-excluded' : 'geom-included';
    // accuracy stored under the same path used by createPopupContent
    const accuracyClass = window.getAccuracyClass(properties && properties['gathering.interpretations.coordinateAccuracy']);
    if (accuracyClass) {
        className = accuracyClass;
    }

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
            const polyDbId = properties && (properties._db_id || properties.db_id);
            const polyPopup = polyDbId
                ? createPopupContent(properties || {}, { showConvertBtn: true })
                : popupContent;
            poly.bindPopup(polyPopup);
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
            alert('Päivitys epäonnistui: ' + (data && data.error ? data.error : 'tuntematon virhe'));
            return;
        }

        // Update button state
        btn.setAttribute('data-excluded', data.excluded ? '1' : '0');
        btn.textContent = data.excluded ? 'Sisällytä analyysiin' : 'Poista analyysista';

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
        alert('Virhe poiston vaihtamisessa: ' + e.message);
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

// ─── Polygon → Point conversion ─────────────────────────────────────────────

/**
 * Enter conversion mode for a polygon observation.
 * Hides the polygon, shows a draggable point at the centroid constrained to
 * stay inside the original polygon boundary, and shows Save/Cancel controls.
 */
window.startPolygonToPointConversion = function(obsId) {
    if (!obsId) return;

    // Prevent two concurrent conversions
    if (window._conversionActiveObs) {
        alert('Muunnos on jo käynnissä. Tallenna tai peruuta se ensin.');
        return;
    }

    // Find all layers belonging to this observation
    const foundLayers = [];
    let savedGeometry = null;
    let savedProperties = null;

    if (window.sharedGeometryLayer) {
        window.sharedGeometryLayer.eachLayer(function(layer) {
            const props = (layer.feature && layer.feature.properties) || layer.feature || {};
            const id = props._db_id || props.db_id;
            if (id && String(id) === String(obsId)) {
                foundLayers.push(layer);
                if (!savedGeometry && layer.feature && layer.feature.geometry) {
                    savedGeometry = layer.feature.geometry;
                    savedProperties = props;
                }
            }
        });
    }

    if (!foundLayers.length || !savedGeometry) {
        alert('Havaintoa ei löytynyt kartalta.');
        return;
    }

    // Close any open popup
    window.sharedMap.closePopup();

    // Remove polygon layers temporarily (keep reference for cancel)
    const hiddenLayers = [];
    foundLayers.forEach(function(l) {
        try { window.sharedGeometryLayer.removeLayer(l); } catch (e) {}
        const dsId = savedProperties && (savedProperties._dataset_id || savedProperties.dataset_id);
        if (dsId && window.datasetLayers && window.datasetLayers[dsId]) {
            try { window.datasetLayers[dsId].group.removeLayer(l); } catch (e) {}
        }
        hiddenLayers.push(l);
    });

    // Show original polygon outline as a reference overlay so the user can see the boundary
    const refLayer = L.geoJSON({ type: 'Feature', geometry: savedGeometry, properties: {} }, {
        style: {
            color: '#3b82f6',
            weight: 2,
            opacity: 0.8,
            fillColor: '#3b82f6',
            fillOpacity: 0.08,
            dashArray: '6,4'
        }
    }).addTo(window.sharedMap);

    // Compute centroid as starting position
    const centroid = window.polygonCentroid(savedGeometry);
    let lastValidLatLng = L.latLng(centroid.lat, centroid.lng);

    // Draggable marker using a divIcon styled as a circle
    const dragIcon = L.divIcon({
        className: 'geom-conversion-mode',
        iconSize: [20, 20],
        iconAnchor: [10, 10]
    });

    const dragMarker = L.marker([centroid.lat, centroid.lng], {
        draggable: true,
        icon: dragIcon,
        zIndexOffset: 1000
    }).addTo(window.sharedMap);

    // During drag: validate position against polygon boundary and snap back if outside
    dragMarker.on('drag', function(e) {
        const ll = e.target.getLatLng();
        if (window.pointInPolygonGeometry([ll.lng, ll.lat], savedGeometry)) {
            lastValidLatLng = ll;
        } else {
            e.target.setLatLng(lastValidLatLng);
        }
    });

    dragMarker.on('dragend', function(e) {
        const ll = e.target.getLatLng();
        if (!window.pointInPolygonGeometry([ll.lng, ll.lat], savedGeometry)) {
            e.target.setLatLng(lastValidLatLng);
        } else {
            lastValidLatLng = ll;
        }
    });

    // Inject conversion panel into the map container
    const mapContainer = window.sharedMap.getContainer();
    const existingPanel = document.getElementById('conversion-panel');
    if (existingPanel) existingPanel.remove();

    const panel = document.createElement('div');
    panel.id = 'conversion-panel';
    panel.innerHTML =
        '<div class="conversion-panel-inner">' +
        '<p class="conversion-instruction">Siirrä piste haluamaasi sijaintiin sinisen alueen sisällä, sitten tallenna.</p>' +
        '<div class="conversion-actions">' +
        '<button class="conversion-save-btn" onclick="window._confirmPolygonToPoint()">Tallenna</button>' +
        '<button class="conversion-cancel-btn" onclick="window._cancelPolygonToPoint()">Peruuta</button>' +
        '</div></div>';
    mapContainer.appendChild(panel);

    // Store conversion state globally so confirm/cancel can access it
    window._conversionActiveObs = {
        obsId: obsId,
        hiddenLayers: hiddenLayers,
        dragMarker: dragMarker,
        refLayer: refLayer,
        savedGeometry: savedGeometry,
        savedProperties: savedProperties,
        getLatLng: function() { return lastValidLatLng; }
    };
};

/**
 * Save the converted point position to the database and swap the polygon layer.
 */
window._confirmPolygonToPoint = async function() {
    const state = window._conversionActiveObs;
    if (!state) return;

    const ll = state.getLatLng();
    const newGeometry = { type: 'Point', coordinates: [ll.lng, ll.lat] };

    // Disable buttons while saving
    const panel = document.getElementById('conversion-panel');
    if (panel) panel.querySelectorAll('button').forEach(function(b) { b.disabled = true; b.textContent = b.className.includes('save') ? 'Tallennetaan...' : b.textContent; });

    try {
        const res = await fetch('/api/observation/' + state.obsId + '/geometry', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ geometry: newGeometry })
        });

        if (!res.ok) {
            const err = await res.json().catch(function() { return {}; });
            alert('Muunnos epäonnistui: ' + (err.error || res.statusText));
            if (panel) panel.querySelectorAll('button').forEach(function(b) { b.disabled = false; });
            return;
        }

        // Clean up conversion UI
        try { window.sharedMap.removeLayer(state.dragMarker); } catch (e) {}
        try { window.sharedMap.removeLayer(state.refLayer); } catch (e) {}
        if (panel) panel.remove();

        // Create new point layer with original properties (geometry updated in-memory too)
        const newProps = Object.assign({}, state.savedProperties);
        const newLayers = window.createGeometryLayers(newGeometry, newProps);
        if (newLayers) {
            (function addLayer(l) {
                if (Array.isArray(l)) { l.forEach(addLayer); return; }
                window.sharedGeometryLayer.addLayer(l);
            })(newLayers);
        }

        if (typeof window.syncLegendWithFeatures === 'function') {
            try { window.syncLegendWithFeatures(); } catch (e) {}
        }
        if (typeof window.recalculateGrid === 'function') {
            try { window.recalculateGrid(); } catch (e) {}
        }

    } catch (e) {
        console.error('Error confirming polygon to point conversion:', e);
        alert('Virhe muunnoksen tallennuksessa: ' + e.message);
        if (panel) panel.querySelectorAll('button').forEach(function(b) { b.disabled = false; });
        return;
    }

    window._conversionActiveObs = null;
};

/**
 * Cancel the conversion and restore the original polygon on the map.
 */
window._cancelPolygonToPoint = function() {
    const state = window._conversionActiveObs;
    if (!state) return;

    try { window.sharedMap.removeLayer(state.dragMarker); } catch (e) {}
    try { window.sharedMap.removeLayer(state.refLayer); } catch (e) {}

    // Restore hidden polygon layers
    state.hiddenLayers.forEach(function(l) {
        try { window.sharedGeometryLayer.addLayer(l); } catch (e) {}
        const props = (l.feature && l.feature.properties) || l.feature || {};
        const dsId = props._dataset_id || props.dataset_id;
        if (dsId && window.datasetLayers && window.datasetLayers[dsId]) {
            try { window.datasetLayers[dsId].group.addLayer(l); } catch (e) {}
        }
    });

    const panel = document.getElementById('conversion-panel');
    if (panel) panel.remove();

    window._conversionActiveObs = null;
};

// ─── Move point within uncertainty radius ────────────────────────────────────

/**
 * Enter move mode for a point observation.
 * Shows a draggable marker constrained within a circle whose radius equals
 * the feature's coordinateAccuracy value (metres). The original position and
 * all properties are preserved unless the user saves.
 */
window.startPointMoveConversion = function(obsId) {
    if (!obsId) return;

    if (window._conversionActiveObs) {
        alert('Muunnos on jo käynnissä. Tallenna tai peruuta se ensin.');
        return;
    }

    // Find the CircleMarker layer
    let foundLayer = null;
    let savedProperties = null;
    let savedGeometry = null;

    if (window.sharedGeometryLayer) {
        window.sharedGeometryLayer.eachLayer(function(layer) {
            if (foundLayer) return;
            const props = (layer.feature && layer.feature.properties) || layer.feature || {};
            const id = props._db_id || props.db_id;
            if (id && String(id) === String(obsId)) {
                foundLayer = layer;
                savedProperties = props;
                savedGeometry = layer.feature && layer.feature.geometry;
            }
        });
    }

    if (!foundLayer || !savedGeometry) {
        alert('Havaintoa ei löytynyt kartalta.');
        return;
    }

    const accuracyMeters = parseFloat(
        savedProperties['gathering.interpretations.coordinateAccuracy']
    );
    if (!accuracyMeters || isNaN(accuracyMeters) || accuracyMeters < 10) {
        alert('Pistettä ei voi siirtää: koordinaattien tarkkuus on alle 10 metriä tai se puuttuu.');
        return;
    }

    window.sharedMap.closePopup();

    // Remove original point from both shared layer and dataset group
    const hiddenLayers = [];
    try { window.sharedGeometryLayer.removeLayer(foundLayer); } catch (e) {}
    const dsId = savedProperties._dataset_id || savedProperties.dataset_id;
    if (dsId && window.datasetLayers && window.datasetLayers[dsId]) {
        try { window.datasetLayers[dsId].group.removeLayer(foundLayer); } catch (e) {}
    }
    hiddenLayers.push(foundLayer);

    // Original position (Point coordinates are [lng, lat])
    const origLng = savedGeometry.coordinates[0];
    const origLat = savedGeometry.coordinates[1];
    const origLatLng = L.latLng(origLat, origLng);
    let lastValidLatLng = origLatLng;

    // Show accuracy circle as boundary reference
    const refLayer = L.circle(origLatLng, {
        radius: accuracyMeters,
        color: '#3b82f6',
        weight: 2,
        opacity: 0.8,
        fillColor: '#3b82f6',
        fillOpacity: 0.08,
        dashArray: '6,4'
    }).addTo(window.sharedMap);

    // Draggable marker at original position
    const dragIcon = L.divIcon({
        className: 'geom-conversion-mode',
        iconSize: [20, 20],
        iconAnchor: [10, 10]
    });

    const dragMarker = L.marker(origLatLng, {
        draggable: true,
        icon: dragIcon,
        zIndexOffset: 1000
    }).addTo(window.sharedMap);

    // Constrain drag to within the accuracy radius
    dragMarker.on('drag', function(e) {
        const ll = e.target.getLatLng();
        if (ll.distanceTo(origLatLng) <= accuracyMeters) {
            lastValidLatLng = ll;
        } else {
            e.target.setLatLng(lastValidLatLng);
        }
    });

    dragMarker.on('dragend', function(e) {
        const ll = e.target.getLatLng();
        if (ll.distanceTo(origLatLng) > accuracyMeters) {
            e.target.setLatLng(lastValidLatLng);
        } else {
            lastValidLatLng = ll;
        }
    });

    // Conversion panel (reuses same save/cancel functions as polygon conversion)
    const mapContainer = window.sharedMap.getContainer();
    const existingPanel = document.getElementById('conversion-panel');
    if (existingPanel) existingPanel.remove();

    const accuracyLabel = accuracyMeters >= 1000
        ? (accuracyMeters / 1000).toFixed(1) + ' km'
        : Math.round(accuracyMeters) + ' m';

    const panel = document.createElement('div');
    panel.id = 'conversion-panel';
    panel.innerHTML =
        '<div class="conversion-panel-inner">' +
        '<p class="conversion-instruction">Siirrä piste koordinaattien epätarkkuutta ('+ accuracyLabel +') kuvaavan ympyrän sisällä, sitten tallenna.</p>' +
        '<div class="conversion-actions">' +
        '<button class="conversion-save-btn" onclick="window._confirmPolygonToPoint()">Tallenna</button>' +
        '<button class="conversion-cancel-btn" onclick="window._cancelPolygonToPoint()">Peruuta</button>' +
        '</div></div>';
    mapContainer.appendChild(panel);

    // Shared state — _confirmPolygonToPoint and _cancelPolygonToPoint read from here
    window._conversionActiveObs = {
        obsId: obsId,
        hiddenLayers: hiddenLayers,
        dragMarker: dragMarker,
        refLayer: refLayer,
        savedGeometry: savedGeometry,
        savedProperties: savedProperties,
        getLatLng: function() { return lastValidLatLng; }
    };
};