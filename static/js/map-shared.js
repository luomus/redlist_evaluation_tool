/* global L */

// Shared map utilities for handling geometries

// Create a shared Leaflet map and helper objects. Returns an object with
// `{ map, geometryLayer, stats, updateStatus }`.
window.createSharedMap = function(containerId = 'map', center = [60.1699, 24.9384], zoom = 6) {
    const map = L.map(containerId).setView(center, zoom);

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

// Setup handler for detecting and displaying multiple overlapping features
function setupMultiFeatureHandler(map, geometryLayer) {
    // Handle clicks on the geometry layer - only for CircleMarkers (points)
    geometryLayer.on('click', function(e) {
        const clickedLayer = e.layer;
        
        // Only handle CircleMarkers (points) - let polygons/lines use default popup
        if (!(clickedLayer instanceof L.CircleMarker)) {
            return; // Let default popup handling work for non-point features
        }
        
        const clickLatLng = e.latlng;
        
        // Find all point features at or very near the click location
        const nearbyFeatures = [];
        const pixelRadius = 10; // pixels
        const point = map.latLngToContainerPoint(clickLatLng);
        
        geometryLayer.eachLayer(function(layer) {
            // Only check CircleMarkers (points)
            if (!(layer instanceof L.CircleMarker)) {
                return;
            }
            
            const layerPoint = map.latLngToContainerPoint(layer.getLatLng());
            const distance = point.distanceTo(layerPoint);
            
            if (distance < pixelRadius) {
                nearbyFeatures.push(layer);
            }
        });
        
        // Create and show appropriate popup
        if (nearbyFeatures.length > 1) {
            const popupContent = createMultiFeaturePopup(nearbyFeatures);
            L.popup()
                .setLatLng(clickLatLng)
                .setContent(popupContent)
                .openOn(map);
        } else if (nearbyFeatures.length === 1) {
            const popupContent = createPopupContent(nearbyFeatures[0].feature.properties || {});
            L.popup()
                .setLatLng(clickLatLng)
                .setContent(popupContent)
                .openOn(map);
        }
        
        L.DomEvent.stopPropagation(e);
    });
}

// Create popup content for multiple overlapping features
function createMultiFeaturePopup(features) {
    let content = '<div class="multi-feature-popup">';
    content += `<div class="popup-header"><strong>${features.length} observations at this location</strong></div>`;
    
    features.forEach((layer, index) => {
        const props = layer.feature.properties || {};
        const scientificName = props['unit.linkings.taxon.scientificName'] || 'Unknown species';
        const date = props['gathering.displayDateTime'] || 'No date';
        const dbId = props['_db_id'] || props['db_id'];
        const isExcluded = props['excluded'];
        
        const excludedClass = isExcluded ? 'excluded-feature' : '';
        
        content += `<div class="feature-item ${excludedClass}" data-feature-index="${index}">`;
        content += `<div class="feature-summary" onclick="window.toggleFeatureDetails(${index}, this)">`;
        content += `<span class="feature-number">${index + 1}.</span> `;
        content += `<span class="feature-name">${scientificName}</span>`;
        content += `<span class="feature-date"> - ${date}</span>`;
        content += `<span class="expand-icon">▼</span>`;
        content += `</div>`;
        
        content += `<div class="feature-details" id="feature-details-${index}" style="display:none;">`;
        content += createPopupContent(props).replace('<div class="popup-content">', '').replace('</div>', '');
        content += `</div>`;
        
        content += `</div>`;
    });
    
    content += '</div>';
    
    // Store features globally for detail toggle
    window._currentMultiFeatures = features;
    
    return content;
}

// Toggle feature details in multi-feature popup
window.toggleFeatureDetails = function(index, element) {
    const detailsDiv = document.getElementById(`feature-details-${index}`);
    const expandIcon = element.querySelector('.expand-icon');
    
    if (detailsDiv.style.display === 'none') {
        detailsDiv.style.display = 'block';
        expandIcon.textContent = '▲';
    } else {
        detailsDiv.style.display = 'none';
        expandIcon.textContent = '▼';
    }
};

// Polygon selector and bulk enable/disable controls
// Adds a small UI control to start polygon selection, finish/cancel drawing
// and buttons to enable/disable all features at once. Does not require
// external drawing libraries.
function setupPolygonSelector(map, geometryLayer) {
    let selecting = false;
    let points = [];
    let markersLayer = L.layerGroup().addTo(map);
    let tempLine = L.polyline([], { color: '#3388ff', dashArray: '5,5' }).addTo(map);
    let selectionPolygon = null;
    let selectionPopup = null;
    let startMarker = null;

    const control = L.control({ position: 'topright' });
    control.onAdd = function() {
        const div = L.DomUtil.create('div', 'leaflet-bar polygon-selector-control');
        div.innerHTML = `
            <button id="polySelectBtn" title="Start polygon selection">🔺 Polygon</button>
            <button id="disableAllBtn" title="Disable all">Disable all</button>
            <button id="enableAllBtn" title="Enable all">Enable all</button>
        `;
        L.DomEvent.disableClickPropagation(div);
        return div;
    };
    control.addTo(map);

    // Start or cancel drawing
    function clearSelectionDrawing() {
        points = [];
        markersLayer.clearLayers();
        tempLine.setLatLngs([]);
        if (selectionPolygon) {
            map.removeLayer(selectionPolygon);
            selectionPolygon = null;
        }
        if (selectionPopup) {
            map.closePopup(selectionPopup);
            selectionPopup = null;
        }
        if (startMarker) {
            try { map.removeLayer(startMarker); } catch (e) {}
            startMarker = null;
        }
        selecting = false;
        const selBtn = document.getElementById('polySelectBtn');
        if (selBtn) selBtn.textContent = '🔺 Polygon';
        map.off('click', onMapClick);
        map.off('dblclick', onMapDblClick);
        try { map.dragging.enable(); if (map.doubleClickZoom) map.doubleClickZoom.enable(); } catch (e) { /* ignore */ }
    }

    // Finish drawing and create selection polygon
    function finishDrawing() {
        if (points.length < 3) {
            alert('Draw a polygon with at least 3 points.');
            return;
        }
        selectionPolygon = L.polygon(points, { color: '#f39c12', weight: 2, fillOpacity: 0.15 }).addTo(map);
        tempLine.setLatLngs([]);
        markersLayer.clearLayers();
        if (startMarker) {
            try { map.removeLayer(startMarker); } catch (e) {}
            startMarker = null;
        }
        selecting = false;
        const selBtn = document.getElementById('polySelectBtn');
        if (selBtn) selBtn.textContent = '🔺 Polygon';
        map.off('click', onMapClick);
        map.off('dblclick', onMapDblClick);
        try { map.dragging.enable(); if (map.doubleClickZoom) map.doubleClickZoom.enable(); } catch (e) { /* ignore */ }

        // Show popup with actions
        const center = selectionPolygon.getBounds().getCenter();
        const popupHtml = `<div class="polygon-actions"><button id="disableSelected">Disable selected</button> <button id="enableSelected">Enable selected</button> <button id="clearSelection">Clear selection</button></div>`;
        selectionPopup = L.popup({ maxWidth: 260 }).setLatLng(center).setContent(popupHtml).openOn(map);

        // If the user closes the popup (clicks X or outside), remove the polygon
        map.once('popupclose', function(e) {
            try {
                if (e && e.popup === selectionPopup) {
                    if (selectionPolygon) {
                        map.removeLayer(selectionPolygon);
                        selectionPolygon = null;
                    }
                    selectionPopup = null;
                }
            } catch (err) { /* ignore */ }
        });

        // Attach handlers after popup opens
        setTimeout(() => {
            const disableBtn = document.getElementById('disableSelected');
            const enableBtn = document.getElementById('enableSelected');
            const clearBtn = document.getElementById('clearSelection');
            if (disableBtn) disableBtn.addEventListener('click', () => applyExcludeToSelection(true));
            if (enableBtn) enableBtn.addEventListener('click', () => applyExcludeToSelection(false));
            if (clearBtn) clearBtn.addEventListener('click', () => { map.closePopup(); if (selectionPolygon) { map.removeLayer(selectionPolygon); selectionPolygon = null; } });
        }, 50);
    }

    // When drawing, click to add points. Clicking near the first point (or double-click) finishes automatically.
    function onMapClick(e) {
        // If click near first point and have 3+ points, finish
        if (points.length > 0) {
            const containerPoint = map.latLngToContainerPoint(e.latlng);
            const firstContainer = map.latLngToContainerPoint(points[0]);
            const dist = containerPoint.distanceTo(firstContainer);
            if (points.length >= 3 && dist < 10) {
                finishDrawing();
                return;
            }
        }

        // Normal add point behavior
        points.push(e.latlng);
        const mkStyle = { radius: 4, color: '#3388ff', fillColor: '#3388ff', fillOpacity: 1 };
        const mk = L.circleMarker(e.latlng, mkStyle).addTo(markersLayer);
        tempLine.addLatLng(e.latlng);

        // If this is the first point, add a standout start marker that is clickable to finish
        if (points.length === 1) {
            try {
                startMarker = L.circleMarker(e.latlng, { radius: 6, color: '#e67e22', fillColor: '#e67e22', fillOpacity: 0.9 }).addTo(map);
                startMarker.on('click', function() { if (points.length >= 3) finishDrawing(); });
                startMarker.bindTooltip('Click to close polygon', { permanent: false, direction: 'top' });
            } catch (e) {
                startMarker = null;
            }
        }
    }

    function onMapDblClick() {
        if (selecting && points.length >= 3) {
            finishDrawing();
        }
    }

    document.getElementById('polySelectBtn').addEventListener('click', () => {
        if (selecting) {
            // Cancel
            clearSelectionDrawing();
            return;
        }
        selecting = true;
        points = [];
        markersLayer.clearLayers();
        tempLine.setLatLngs([]);
        const selBtn = document.getElementById('polySelectBtn');
        if (selBtn) selBtn.textContent = '✖ Cancel drawing';
        map.on('click', onMapClick);
        map.on('dblclick', onMapDblClick);
        try { map.dragging.disable(); if (map.doubleClickZoom) map.doubleClickZoom.disable(); } catch (e) { /* ignore */ }
    });

    // Utility: ray-casting point-in-polygon test (latlng objects {lat, lng})
    function pointInPolygon(pt, vs) {
        const x = pt.lng, y = pt.lat;
        let inside = false;
        for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
            const xi = vs[i].lng, yi = vs[i].lat;
            const xj = vs[j].lng, yj = vs[j].lat;

            const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi + 0.0) + xi);
            if (intersect) inside = !inside;
        }
        return inside;
    }

    // Flatten nested latlngs to an array of latlngs
    function flattenLatLngs(arr) {
        const out = [];
        (function rec(a) {
            if (!a) return;
            if (Array.isArray(a)) {
                a.forEach(v => rec(v));
            } else if (a.lat !== undefined && a.lng !== undefined) {
                out.push(a);
            }
        })(arr);
        return out;
    }

    function getLayersInSelection() {
        if (!selectionPolygon) return [];
        const polyPoints = selectionPolygon.getLatLngs()[0];
        const selected = [];
        geometryLayer.eachLayer(function(layer) {
            try {
                if (layer instanceof L.CircleMarker) {
                    if (pointInPolygon(layer.getLatLng(), polyPoints)) selected.push(layer);
                } else {
                    const latlngs = flattenLatLngs(layer.getLatLngs && layer.getLatLngs());
                    if (latlngs && latlngs.length) {
                        for (let i = 0; i < latlngs.length; i++) {
                            if (pointInPolygon(latlngs[i], polyPoints)) { selected.push(layer); break; }
                        }
                    }
                }
            } catch (e) {
                // ignore non-geo layers
            }
        });
        return selected;
    }

    async function applyExcludeToSelection(exclude) {
        const layers = getLayersInSelection();
        if (!layers.length) { alert('No features found inside selection.'); return; }
        const dbIds = [];
        layers.forEach(l => {
            const props = (l.feature && l.feature.properties) || l.feature || {};
            const id = props && (props._db_id || props.db_id);
            if (id) dbIds.push(id);
        });
        if (!dbIds.length) { alert('No DB-backed features in selection.'); return; }

        if (!confirm(`Apply ${exclude ? 'disable' : 'enable'} to ${dbIds.length} observations?`)) return;
        try {
            const res = await window.setExcludeBatch(dbIds, exclude);
            map.closePopup();
            if (selectionPolygon) { map.removeLayer(selectionPolygon); selectionPolygon = null; }
            alert(`Processed ${res.processed} observations (${res.failed} failed).`);
        } catch (e) {
            console.error('Batch exclude encountered an error', e);
            alert('Error processing selection: ' + (e && e.message));
        }
    }

    // Enable/Disable all buttons
    document.getElementById('disableAllBtn').addEventListener('click', async () => {
        if (!confirm('Disable all observations visible on the map?')) return;
        const ids = [];
        geometryLayer.eachLayer(l => {
            const props = (l.feature && l.feature.properties) || l.feature || {};
            const id = props && (props._db_id || props.db_id);
            if (id) ids.push(id);
        });
        try {
            const r = await window.setExcludeBatch(ids, true);
            alert(`Disabled ${r.processed} observations (${r.failed} failed).`);
        } catch (e) {
            console.error('Error disabling all:', e);
            alert('Error disabling observations: ' + (e && e.message));
        }
    });
    document.getElementById('enableAllBtn').addEventListener('click', async () => {
        if (!confirm('Enable all observations visible on the map?')) return;
        const ids = [];
        geometryLayer.eachLayer(l => {
            const props = (l.feature && l.feature.properties) || l.feature || {};
            const id = props && (props._db_id || props.db_id);
            if (id) ids.push(id);
        });
        try {
            const r = await window.setExcludeBatch(ids, false);
            alert(`Enabled ${r.processed} observations (${r.failed} failed).`);
        } catch (e) {
            console.error('Error enabling all:', e);
            alert('Error enabling observations: ' + (e && e.message));
        }
    });
}

// Set exclude status to a specific value (true/false) for an observation ID
window.setExclude = async function(obsId, excluded) {
    try {
        if (!obsId) return;
        const res = await fetch(`/api/observation/${obsId}/exclude`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ excluded: !!excluded })
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            console.error('Failed to update:', err.error || res.statusText);
            return;
        }
        const data = await res.json();
        if (data.success) {
            // Update geometry layers that reference this id
            const targetId = String(obsId);
            if (window.sharedGeometryLayer && typeof window.sharedGeometryLayer.eachLayer === 'function') {
                window.sharedGeometryLayer.eachLayer(function(layer) {
                    const props = (layer.feature && layer.feature.properties) || layer.feature || {};
                    const layerDbId = props._db_id || props.db_id;
                    if (layerDbId && String(layerDbId) === targetId) {
                        props.excluded = data.excluded;
                        try {
                            const el = (typeof layer.getElement === 'function') ? layer.getElement() : null;
                            if (el && el.classList) {
                                el.classList.toggle('geom-excluded', !!data.excluded);
                                el.classList.toggle('geom-included', !data.excluded);
                            }
                        } catch (e) {}
                        try {
                            if (window.sharedGridFeatures && Array.isArray(window.sharedGridFeatures)) {
                                window.sharedGridFeatures.forEach(f => {
                                    const fId = f && f.properties && (f.properties._db_id || f.properties.db_id);
                                    if (fId && String(fId) === targetId) {
                                        f.properties = f.properties || {};
                                        f.properties.excluded = data.excluded;
                                    }
                                });
                            }
                        } catch (e) {}
                        if (typeof window.recalculateGrid === 'function') { try { window.recalculateGrid(); } catch (e) {} }
                    }
                });
            }
        } else {
            console.error('Failed to update: ' + (data.error || 'unknown error'));
        }
    } catch (e) {
        console.error('Error setting exclude:', e);
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

    for (let i = 0; i < ids.length; i += batchSize) {
        const chunk = ids.slice(i, i + batchSize);

        const promises = chunk.map(id => {
            return fetch(`/api/observation/${id}/exclude`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ excluded: !!excluded })
            })
            .then(async res => {
                if (!res.ok) {
                    const err = await res.json().catch(() => ({}));
                    throw new Error(err.error || res.statusText || 'request-failed');
                }
                const data = await res.json().catch(() => ({}));
                return { success: !!data.success, excluded: data.excluded, id };
            })
            .catch(err => ({ success: false, error: err.message || String(err), id }));
        });

        const results = await Promise.all(promises);

        results.forEach(result => {
            const targetId = String(result.id);
            if (result.success) {
                processed++;
                // Update geometry layers that reference this id (same logic as single-set)
                try {
                    if (window.sharedGeometryLayer && typeof window.sharedGeometryLayer.eachLayer === 'function') {
                        window.sharedGeometryLayer.eachLayer(function(layer) {
                            const props = (layer.feature && layer.feature.properties) || layer.feature || {};
                            const layerDbId = props._db_id || props.db_id;
                            if (layerDbId && String(layerDbId) === targetId) {
                                props.excluded = result.excluded;
                                try {
                                    const el = (typeof layer.getElement === 'function') ? layer.getElement() : null;
                                    if (el && el.classList) {
                                        el.classList.toggle('geom-excluded', !!result.excluded);
                                        el.classList.toggle('geom-included', !result.excluded);
                                    }
                                } catch (e) {}
                                try {
                                    if (window.sharedGridFeatures && Array.isArray(window.sharedGridFeatures)) {
                                        window.sharedGridFeatures.forEach(f => {
                                            const fId = f && f.properties && (f.properties._db_id || f.properties.db_id);
                                            if (fId && String(fId) === targetId) {
                                                f.properties = f.properties || {};
                                                f.properties.excluded = result.excluded;
                                            }
                                        });
                                    }
                                } catch (e) {}
                                if (typeof window.recalculateGrid === 'function') { try { window.recalculateGrid(); } catch (e) {} }
                            }
                        });
                    }
                } catch (e) {
                    console.error('Error updating layer styles after batch exclude:', e);
                }
            } else {
                failed++;
                console.error('Batch exclude failed for', result.id, result.error || 'unknown');
            }
        });
    }

    return { processed, failed };
}


// Generic paginated observations fetcher. Calls `perFeature(feature)` for
// each feature and `onComplete(meta)` once all pages are processed. Expects
// an `updateStatus` function to display progress.
window.fetchAllObservationsGeneric = async function(datasetId, perFeature, updateStatus, onComplete) {
    updateStatus('Loading observations...');
    try {
        const firstResponse = await fetch(`/api/observations/${datasetId}?page=1&per_page=5000&`);
        if (!firstResponse.ok) throw new Error(`HTTP error! status: ${firstResponse.status}`);
        const firstData = await firstResponse.json();

        if (!firstData.features || firstData.features.length === 0) {
            updateStatus('No observations found for this dataset');
            return;
        }

        const datasetName = firstData.dataset_name || 'Dataset';
        const totalPages = firstData.pagination.pages;
        const total = firstData.pagination.total;

        updateStatus(`Loading ${datasetName} (page 1 of ${totalPages})...`);

        firstData.features.forEach(f => perFeature(f));

        const fetchPromises = [];
        for (let p = 2; p <= totalPages; p++) {
            fetchPromises.push(
                fetch(`/api/observations/${datasetId}?page=${p}&per_page=5000`)
                    .then(r => r.json())
                    .then(data => {
                        updateStatus(`Loading ${datasetName} (page ${p} of ${totalPages})...`);
                        data.features.forEach(f => perFeature(f));
                    })
            );
        }

        await Promise.all(fetchPromises);

        if (typeof onComplete === 'function') {
            onComplete({ datasetName, totalPages, total });
        }
    } catch (err) {
        console.error('Error fetching observations:', err);
        updateStatus(`Error loading data: ${err.message}`);
    }
};


// Function to create a popup content from properties
function createPopupContent(properties) {
    let content = '<div class="popup-content">';
    
    // Extract common important fields
    const scientificName = properties['unit.linkings.taxon.scientificName'];
    const locality = properties['gathering.locality'];
    const date = properties['gathering.displayDateTime'];
    const individualCount = properties['unit.interpretations.individualCount'];
    const recordQuality = properties['unit.interpretations.recordQuality'];
    const recordBasis = properties['unit.recordBasis'];
    const unitID = properties['unit.unitId'];
    const coordinateAccuracy = properties['gathering.interpretations.coordinateAccuracy'];
    const collectionID = properties['document.collectionId']
    const team = (() => {
        const props = properties || {};
        // Collect keys like 'gathering.team[0]', 'gathering.team[1]', ...
        const keys = Object.keys(props).filter(k => /^gathering\.team\[\d+\]$/.test(k));
        if (keys.length) {
            return keys
                .map(k => props[k])
                .filter(v => v !== undefined && v !== null && String(v).trim() !== '')
                .join(', ');
        }
        // Fallbacks: single indexed key, or plain 'gathering.team'
        return props['gathering.team[0]'] || props['gathering.team'] || null;
    })();

    if (scientificName) {
        content += `<strong>Species:</strong> ${scientificName}<br>`;
    }
    if (locality) {
        content += `<strong>Locality:</strong> ${locality}<br>`;
    }
    if (date) {
        content += `<strong>Date:</strong> ${date}<br>`;
    }
    if (individualCount) {
        content += `<strong>Count:</strong> ${individualCount}<br>`;
    }
    if (recordQuality) {
        content += `<strong>recordQuality:</strong> ${recordQuality}<br>`;
    }
    if (recordBasis) {
        content += `<strong>Basis:</strong> ${recordBasis}<br>`;
    }
    if (unitID) {
        // Make Unit ID a link to a unit page (opens in a new tab)
        content += `<strong>Unit ID:</strong> <a href="${unitID}" target="_blank" rel="noopener noreferrer">${unitID}</a><br>`;
    }
    if (team) {
        content += `<strong>Team:</strong> ${team}<br>`;
    }
    if (coordinateAccuracy) {
        content += `<strong>Coordinate Accuracy:</strong> ${coordinateAccuracy} meters<br>`;
    }
    if (collectionID) {
        // Make Collection ID a link to a collection page (opens in a new tab)
        content += `<strong>Collection ID:</strong> <a href="${collectionID}" target="_blank" rel="noopener noreferrer">${collectionID}</a><br>`;
    }
    
    // Add Enable / Include button if this feature references a DB record
    const dbId = properties && (properties['_db_id'] || properties['db_id']);
    const isExcluded = properties && properties['excluded'];
    if (dbId) {
        const btnLabel = isExcluded ? 'Enable in analysis' : 'Disable from analysis';
        const dataExcluded = isExcluded ? '1' : '0';
        content += `<div class="popup-actions"><button class="exclude-btn" data-db-id="${dbId}" data-excluded="${dataExcluded}" onclick="window.toggleExclude(${dbId}, this)">${btnLabel}</button></div>`;
    }

    content += '</div>';
    return content;
}

// Function to add a geometry to a Leaflet feature group
// Returns the created layer(s)
function addGeometryToLayer(geometry, properties, targetLayer) {
    if (!geometry || !geometry.type) return null;

    const popupContent = createPopupContent(properties || {});

    function addGeometry(geom) {
        const excluded = properties && (properties.excluded === true || properties.excluded === '1' || properties.excluded === 1);
        const className = excluded ? 'geom-excluded' : 'geom-included';

        if (geom.type === 'Point') {
            // Server returns WGS84 [lon, lat]; Leaflet expects [lat, lon]
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
            targetLayer.addLayer(marker);
            try { addToDataset(marker, properties); } catch (e) {}
        } else if (geom.type === 'LineString') {
            const latLngs = geom.coordinates.map(c => [c[1], c[0]]);
            const line = L.polyline(latLngs, { className: className, weight: 7, opacity: 0.8 });
            line.bindPopup(popupContent);
            line.feature = line.feature || {};
            line.feature.properties = properties || {};
            line.feature.geometry = geom;
            targetLayer.addLayer(line);
            try { addToDataset(line, properties); } catch (e) {}
        } else if (geom.type === 'Polygon') {
            const rings = geom.coordinates.map(r => r.map(c => [c[1], c[0]]));
            const polygon = L.polygon(rings, { className: className, weight: 7, opacity: 0.8, fillOpacity: 0.5 });
            polygon.bindPopup(popupContent);
            polygon.feature = polygon.feature || {};
            polygon.feature.properties = properties || {};
            polygon.feature.geometry = geom;
            targetLayer.addLayer(polygon);
            try { addToDataset(polygon, properties); } catch (e) {}
        } else if (geom.type === 'MultiPoint') {
            geom.coordinates.forEach(coord => {
                const lat = coord[1], lon = coord[0];
                const marker = L.circleMarker([lat, lon], { radius: 7, className: className, weight: 1, opacity: 1, fillOpacity: 0.8 });
                marker.feature = marker.feature || {};
                marker.feature.properties = properties || {};
                marker.feature.geometry = { type: 'Point', coordinates: [coord[0], coord[1]] };
                targetLayer.addLayer(marker);
                try { addToDataset(marker, properties); } catch (e) {}
            });
        } else if (geom.type === 'MultiLineString') {
            geom.coordinates.forEach(lineCoords => {
                const latLngs = lineCoords.map(c => [c[1], c[0]]);
                const line = L.polyline(latLngs, { className: className, weight: 7, opacity: 0.8 });
                line.bindPopup(popupContent);
                line.feature = line.feature || {};
                line.feature.properties = properties || {};
                targetLayer.addLayer(line);
                try { addToDataset(line, properties); } catch (e) {}
            });
        } else if (geom.type === 'MultiPolygon') {
            geom.coordinates.forEach(polygonCoords => {
                const rings = polygonCoords.map(r => r.map(c => [c[1], c[0]]));
                const polygon = L.polygon(rings, { className: className, weight: 7, opacity: 0.8, fillOpacity: 0.5 });
                polygon.bindPopup(popupContent);
                polygon.feature = polygon.feature || {};
                polygon.feature.properties = properties || {};
                targetLayer.addLayer(polygon);
                try { addToDataset(polygon, properties); } catch (e) {}
            });
        } else if (geom.type === 'GeometryCollection') {
            if (geom.geometries && Array.isArray(geom.geometries)) {
                geom.geometries.forEach(g => addGeometry(g));
            }
        }
    }

    addGeometry(geometry);
}

// Toggle excluded flag for an observation by DB id. Button element passed as `btn`.
window.toggleExclude = async function(obsId, btn) {
    try {
        if (!obsId) return;
        const current = btn.getAttribute('data-excluded') === '1';
        const newValue = !current;

        const res = await fetch(`/api/observation/${obsId}/exclude`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ excluded: newValue })
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            alert('Failed to update: ' + (err.error || res.statusText));
            return;
        }

        const data = await res.json();
        if (data.success) {
            btn.setAttribute('data-excluded', data.excluded ? '1' : '0');
            btn.textContent = data.excluded ? 'Include in analysis' : 'Exclude from analysis';
            // Update styling of any layers that reference this DB id
            try {
                if (window.sharedGeometryLayer && typeof window.sharedGeometryLayer.eachLayer === 'function') {
                    const targetId = String(obsId);
                    window.sharedGeometryLayer.eachLayer(function(layer) {
                        const props = (layer.feature && layer.feature.properties) || layer.feature || null;
                        if (!props) return;
                        const layerDbId = props._db_id || props.db_id;
                        if (!layerDbId) return;
                        if (String(layerDbId) === targetId) {
                            // update stored property
                            props.excluded = data.excluded;
                            try {
                                const el = (typeof layer.getElement === 'function') ? layer.getElement() : null;
                                if (el && el.classList) {
                                    el.classList.toggle('geom-excluded', !!data.excluded);
                                    el.classList.toggle('geom-included', !data.excluded);
                                }
                            } catch (e) {
                                // ignore styling errors
                            }
                                // Also update any shared features used by grids and request recalculations
                                try {
                                    if (window.sharedGridFeatures && Array.isArray(window.sharedGridFeatures)) {
                                        window.sharedGridFeatures.forEach(f => {
                                            const fId = f && f.properties && (f.properties._db_id || f.properties.db_id);
                                            if (fId && String(fId) === targetId) {
                                                f.properties = f.properties || {};
                                                f.properties.excluded = data.excluded;
                                            }
                                        });
                                    }
                                } catch (e) {
                                    // ignore
                                }
                                // Request grid recalculation if available
                                if (typeof window.recalculateGrid === 'function') {
                                    try { window.recalculateGrid(); } catch (e) { /* ignore */ }
                                }
                        }
                    });
                }
            } catch (e) {
                console.error('Error updating layer styles after exclude:', e);
            }
        } else {
            alert('Failed to update: ' + (data.error || 'unknown error'));
        }
    } catch (e) {
        console.error('Error toggling exclude:', e);
        alert('Error toggling exclude: ' + e.message);
    }
};

    // Shared per-feature handler that updates stats and adds geometry to a target layer.
    // Call as: `addGeometryToMap(geometry, properties, targetLayer, stats)`.
    window.addGeometryToMap = function(geometry, properties, targetLayer, statsObj) {
        if (!geometry || !geometry.type) {
            if (statsObj) statsObj.skipped++;
            return;
        }

        try {
            if (geometry.type === 'GeometryCollection' && geometry.geometries && Array.isArray(geometry.geometries)) {
                geometry.geometries.forEach(g => window.addGeometryToMap(g, properties, targetLayer, statsObj));
                return;
            }

            if (statsObj) statsObj.total++;
            addGeometryToLayer(geometry, properties, targetLayer);
        } catch (err) {
            console.error('Error adding geometry to layer:', err, geometry);
            if (statsObj) statsObj.skipped++;
        }
    };

// Helper: sanitize DOM id for dataset entry
function sanitizeDomId(s) {
    return 'ds-' + String(s || '').replace(/[^a-z0-9_-]/ig, '_');
}

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
        return res;
    } finally {
        window._datasetTogglePending[dsid] = false;
    }
};

// Create a Leaflet control that lists datasets with checkboxes to toggle them
window.createLegendControl = function() {
    const control = L.control({ position: 'topright' });
    control.onAdd = function() {
        const div = L.DomUtil.create('div', 'leaflet-bar legend-control');
        div.innerHTML = `
            <div class="legend-header"><strong>Datasets</strong></div>
            <div id="dataset-legend-list" class="legend-list">Loading…</div>
        `;
        L.DomEvent.disableClickPropagation(div);
        return div;
    };
    control.addTo(window.sharedMap);

    // Populate the legend from server dataset list where available
    const projectId = window.currentProjectId || (new URLSearchParams(window.location.search)).get('id') || null;
    const datasetsUrl = projectId ? `/api/projects/${encodeURIComponent(projectId)}/datasets` : '/api/datasets';
    fetch(datasetsUrl).then(r => r.json()).then(data => {
        const list = document.getElementById('dataset-legend-list');
        list.innerHTML = '';
        const datasets = (data && data.datasets) || [];
        datasets.forEach(ds => {
            // Normalize dataset id and name (both endpoints use slightly different keys)
            const dsId = ds.dataset_id || ds.id || ds.name;
            const dsName = ds.dataset_name || ds.name || dsId;
            const safe = sanitizeDomId(dsId);
            window.datasetLayers = window.datasetLayers || {};
            if (!window.datasetLayers[dsId]) {
                window.datasetLayers[dsId] = { group: L.layerGroup().addTo(window.sharedMap), name: dsName, count: ds.count || 0 };
            } else {
                window.datasetLayers[dsId].name = dsName;
            }
            const checked = true;
            const item = document.createElement('div');
            item.className = 'legend-item';
            item.innerHTML = `<label><input type="checkbox" id="legend-cb-${safe}" ${checked ? 'checked' : ''} data-dsid="${dsId}"> ${dsName} <span class="legend-count" id="legend-count-${safe}">${window.datasetLayers[dsId].count || 0}</span></label>`;
            list.appendChild(item);
            document.getElementById('legend-cb-' + safe).addEventListener('change', async function () {
                const dsid = this.getAttribute('data-dsid');
                const entry = window.datasetLayers[dsid];
                if (!entry) return;
                const checked = this.checked;
                const exclude = !checked;
                if ((entry.count || 0) > 500) {
                    if (!confirm(`This will ${exclude ? 'disable' : 'enable'} ${entry.count} observations. Continue?`)) { this.checked = !checked; return; }
                }
                this.disabled = true;
                try {
                    await window.toggleDatasetExclude(dsid, exclude);
                } catch (err) {
                    console.error('Error toggling dataset exclude:', err);
                    alert('Error toggling dataset: ' + (err && err.message || err));
                    this.checked = !checked;
                } finally {
                    this.disabled = false;
                }
            });
        });

        // Also list any existing datasetLayers not returned by server (e.g., unknown)
        for (const kd in window.datasetLayers) {
            if (!datasets.find(d => String(d.dataset_id || d.id || d.name) === String(kd))) {
                const dsId = kd;
                const dsName = window.datasetLayers[kd].name || kd;
                const safe = sanitizeDomId(dsId);
                if (document.getElementById('legend-cb-' + safe)) continue;
                const item = document.createElement('div');
                item.className = 'legend-item';
                item.innerHTML = `<label><input type="checkbox" id="legend-cb-${safe}" checked data-dsid="${dsId}"> ${dsName} <span class="legend-count" id="legend-count-${safe}">${window.datasetLayers[kd].count || 0}</span></label>`;
                list.appendChild(item);
                document.getElementById('legend-cb-' + safe).addEventListener('change', async function () {
                    const dsid = this.getAttribute('data-dsid');
                    const entry = window.datasetLayers[dsid];
                    if (!entry) return;
                    const checked = this.checked;
                    const exclude = !checked;
                    if ((entry.count || 0) > 500) {
                        if (!confirm(`This will ${exclude ? 'disable' : 'enable'} ${entry.count} observations. Continue?`)) { this.checked = !checked; return; }
                    }
                    this.disabled = true;
                    try {
                        await window.toggleDatasetExclude(dsid, exclude);
                    } catch (err) {
                        console.error('Error toggling dataset exclude:', err);
                        alert('Error toggling dataset: ' + (err && err.message || err));
                        this.checked = !checked;
                    } finally {
                        this.disabled = false;
                    }
                });
            }
        }
    }).catch(err => {
        const list = document.getElementById('dataset-legend-list');
        if (list) list.textContent = '(Failed to load datasets)';
        console.warn('Failed to load datasets for legend', err);
    });

    return control;
};

// Extract all points from geometries (for convex hull calculation, etc.)
function extractAllPoints(geometries) {
    const points = [];
    
    function processGeometry(geom) {
        if (geom.type === 'Point') {
            // Server returns WGS84 [lon, lat]; we store as [lat, lon]
            points.push([geom.coordinates[1], geom.coordinates[0]]);
        } else if (geom.type === 'LineString') {
            geom.coordinates.forEach(coord => {
                points.push([coord[1], coord[0]]);
            });
        } else if (geom.type === 'Polygon') {
            geom.coordinates.forEach(ring => {
                ring.forEach(coord => {
                    points.push([coord[1], coord[0]]);
                });
            });
        } else if (geom.type === 'MultiPoint') {
            geom.coordinates.forEach(coord => {
                points.push([coord[1], coord[0]]);
            });
        } else if (geom.type === 'MultiLineString') {
            geom.coordinates.forEach(lineCoords => {
                lineCoords.forEach(coord => {
                    points.push([coord[1], coord[0]]);
                });
            });
        } else if (geom.type === 'MultiPolygon') {
            geom.coordinates.forEach(polygonCoords => {
                polygonCoords.forEach(ring => {
                    ring.forEach(coord => {
                        points.push([coord[1], coord[0]]);
                    });
                });
            });
        } else if (geom.type === 'GeometryCollection') {
            if (geom.geometries && Array.isArray(geom.geometries)) {
                geom.geometries.forEach(g => processGeometry(g));
            }
        }
    }
    
    geometries.forEach(geom => processGeometry(geom));
    
    return points;
}
