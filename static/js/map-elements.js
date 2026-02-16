/* global L */


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
            <button id="polySelectBtn" title="Start polygon selection">🔺 Polygon selector</button>
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
}

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
    // Resolve latest properties from the live layer (if available) to ensure button shows current state
    let resolvedProps = properties || {};
    const dbId = resolvedProps && (resolvedProps['_db_id'] || resolvedProps['db_id']);
    if (dbId && window.sharedGeometryLayer && typeof window.sharedGeometryLayer.eachLayer === 'function') {
        try {
            window.sharedGeometryLayer.eachLayer(function(layer) {
                try {
                    const p = (layer.feature && layer.feature.properties) || layer.feature || {};
                    const layerDbId = p && (p._db_id || p.db_id);
                    if (layerDbId && String(layerDbId) === String(dbId)) {
                        resolvedProps = p;
                    }
                } catch (e) { /* ignore */ }
            });
        } catch (e) { /* ignore */ }
    }
    const isExcluded = resolvedProps && (resolvedProps.excluded === true || resolvedProps.excluded === '1' || resolvedProps.excluded === 1);
    if (dbId) {
        const btnLabel = isExcluded ? 'Include in analysis' : 'Exclude from analysis';
        const dataExcluded = isExcluded ? '1' : '0';
        content += `<div class="popup-actions"><button class="exclude-btn" data-db-id="${dbId}" data-excluded="${dataExcluded}" onclick="window.toggleExclude(${dbId}, this)">${btnLabel}</button></div>`;
    }

    content += '</div>';
    return content;
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
        const isExcluded = props && (props.excluded === true || props.excluded === '1' || props.excluded === 1);
        
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

// Basemap definitions with popular open-source options
window.basemaps = {
    osm: {
        name: 'OpenStreetMap',
        tileLayers: [
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
                maxZoom: 19
            })
        ]
    },
    cartodark: {
        name: 'CartoDB Positron',
        tileLayers: [
            L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
                attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
                subdomains: 'abcd',
                maxZoom: 20
            })
        ]
    }
};

// Track current basemap
window.currentBasemap = 'osm';

// Function to switch basemap
window.switchBasemap = function(basemapKey) {
    if (!window.basemaps[basemapKey] || !window.sharedMap) return;
    
    const basemap = window.basemaps[basemapKey];
    
    // Remove existing tile layers
    window.sharedMap.eachLayer(function(layer) {
        if (layer instanceof L.TileLayer) {
            window.sharedMap.removeLayer(layer);
        }
    });
    
    // Add new tile layer
    basemap.tileLayers[0].addTo(window.sharedMap);
    window.currentBasemap = basemapKey;
    
    // Update UI
    document.querySelectorAll('[data-basemap-id]').forEach(el => {
        el.classList.toggle('active', el.getAttribute('data-basemap-id') === basemapKey);
    });
};

// Create a Leaflet control that lists datasets with checkboxes to toggle them
window.createLegendControl = function() {
    const control = L.control({ position: 'topright' });
    control.onAdd = function() {
        const div = L.DomUtil.create('div', 'leaflet-bar legend-control');
        div.innerHTML = `
            <div class="legend-header"><strong>Map Controls</strong></div>
            <div class="basemap-section">
                <div class="basemap-label">Basemap:</div>
                <div id="basemap-selector" class="basemap-selector"></div>
            </div>
            <div class="legend-divider"></div>
            <div class="legend-header" style="margin-top: 8px;"><strong>Datasets</strong></div>
            <div id="dataset-legend-list" class="legend-list">Loading…</div>
        `;
        L.DomEvent.disableClickPropagation(div);
        return div;
    };
    control.addTo(window.sharedMap);

    // Populate basemap selector
    const basemapSelector = document.getElementById('basemap-selector');
    for (const [key, basemap] of Object.entries(window.basemaps)) {
        const btn = document.createElement('button');
        btn.className = 'basemap-btn' + (key === 'osm' ? ' active' : '');
        btn.setAttribute('data-basemap-id', key);
        btn.textContent = basemap.name;
        btn.addEventListener('click', () => window.switchBasemap(key));
        basemapSelector.appendChild(btn);
    }

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

                // Compute how many features would actually be affected by this operation
                let affectedCount = 0;
                try {
                    if (entry.group && typeof entry.group.eachLayer === 'function') {
                        entry.group.eachLayer(function(layer) {
                            const props = (layer.feature && layer.feature.properties) || layer.feature || {};
                            const id = props && (props._db_id || props.db_id);
                            if (!id) return;
                            const isExcluded = props.excluded === true || props.excluded === '1' || props.excluded === 1;
                            if ((exclude && !isExcluded) || (!exclude && isExcluded)) affectedCount++;
                        });
                    }
                } catch (e) { console.warn('Error counting affected features for dataset', dsid, e); }

                // Fallback to total count if none found in the group
                if (affectedCount === 0) {
                    // If group has no DB-backed features yet, fall back to known total count
                    affectedCount = entry.count || 0;
                }

                if (affectedCount === 0) {
                    alert(`No observations to ${exclude ? 'disable' : 'enable'} for this dataset.`);
                    this.checked = !checked; // revert
                    return;
                }

                if (affectedCount > 500) {
                    if (!confirm(`This will ${exclude ? 'disable' : 'enable'} ${affectedCount} observations. Continue?`)) { this.checked = !checked; return; }
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

                    // Compute how many features would actually be affected by this operation
                    let affectedCount = 0;
                    try {
                        if (entry.group && typeof entry.group.eachLayer === 'function') {
                            entry.group.eachLayer(function(layer) {
                                const props = (layer.feature && layer.feature.properties) || layer.feature || {};
                                const id = props && (props._db_id || props.db_id);
                                if (!id) return;
                                const isExcluded = props.excluded === true || props.excluded === '1' || props.excluded === 1;
                                if ((exclude && !isExcluded) || (!exclude && isExcluded)) affectedCount++;
                            });
                        }
                    } catch (e) { console.warn('Error counting affected features for dataset', dsid, e); }

                    // Fallback to total count if none found in the group
                    if (affectedCount === 0) {
                        // If group has no DB-backed features yet, fall back to known total count
                        affectedCount = entry.count || 0;
                    }

                    if (affectedCount === 0) {
                        alert(`No observations to ${exclude ? 'disable' : 'enable'} for this dataset.`);
                        this.checked = !checked; // revert
                        return;
                    }

                    if (affectedCount > 500) {
                        if (!confirm(`This will ${exclude ? 'disable' : 'enable'} ${affectedCount} observations. Continue?`)) { this.checked = !checked; return; }
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
        
        // Sync legend with actual feature state after legend is created
        // This handles the case where features were loaded before the legend was created
        if (typeof window.syncLegendWithFeatures === 'function') {
            setTimeout(() => {
                try { window.syncLegendWithFeatures(); } catch (e) { console.warn('Initial legend sync failed:', e); }
            }, 100);
        }
    }).catch(err => {
        const list = document.getElementById('dataset-legend-list');
        if (list) list.textContent = '(Failed to load datasets)';
        console.warn('Failed to load datasets for legend', err);
    });

    return control;
};
