/* global L */

// ─────────────────────────────────────────────────────────────────────────
// Map UI interactions: polygon selector, popups, multi-feature handling, basemap switching
// Depends on: map-geometry.js, map-dialogs.js, map-utils.js
// ─────────────────────────────────────────────────────────────────────────

/**
 * Polygon selector and bulk enable/disable controls
 * Adds a small UI control to start polygon selection, finish/cancel drawing
 * and buttons to enable/disable all features at once. Does not require
 * external drawing libraries.
 */
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
            <button id="polySelectBtn" title="Aloita aluevalinta">🔺 Valitse useita aluerajauksella</button>
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
            window.mapDialogs.notify('Piirrä monikulmio, jossa on vähintään 3 pistettä.');
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
        const popupHtml = `<div class="polygon-actions"><button id="disableSelected">Poista valitut käytöstä</button> <button id="enableSelected">Ota valitut käyttöön</button> <button id="clearSelection">Tyhjennä valinta</button></div>`;
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
                startMarker.bindTooltip('Klikkaa sulkeaksesi alueen', { permanent: false, direction: 'top' });
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
        if (selBtn) selBtn.textContent = '✖ Peruuta';
        map.on('click', onMapClick);
        map.on('dblclick', onMapDblClick);
        try { map.dragging.disable(); if (map.doubleClickZoom) map.doubleClickZoom.disable(); } catch (e) { /* ignore */ }
    });

    function getLayersInSelection() {
        if (!selectionPolygon) return [];
        const polyPoints = selectionPolygon.getLatLngs()[0];
        const selected = [];
        geometryLayer.eachLayer(function(layer) {
            try {
                if (layer instanceof L.CircleMarker) {
                    if (window.pointInPolygon(layer.getLatLng(), polyPoints)) selected.push(layer);
                } else {
                    const latlngs = window.flattenLatLngs(layer.getLatLngs && layer.getLatLngs());
                    if (latlngs && latlngs.length) {
                        for (let i = 0; i < latlngs.length; i++) {
                            if (window.pointInPolygon(latlngs[i], polyPoints)) { selected.push(layer); break; }
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
        if (!layers.length) { window.mapDialogs.notify('Valinnan sisällä ei löytynyt havaintoja.'); return; }
        const dbIds = [];
        layers.forEach(l => {
            const props = (l.feature && l.feature.properties) || l.feature || {};
            const id = props && (props._db_id || props.db_id);
            if (id) dbIds.push(id);
        });
        if (!dbIds.length) { window.mapDialogs.notify('Valinnassa ei ole tietokantaan tallennettuja havaintoja.'); return; }

        if (!await window.mapDialogs.confirm(`Haluatko ${exclude ? 'piilottaa' : 'sisällyttää'} ${dbIds.length} havaintoa?`)) return;
        try {
            const res = await window.setExcludeBatch(dbIds, exclude);
            map.closePopup();
            if (selectionPolygon) { map.removeLayer(selectionPolygon); selectionPolygon = null; }
            window.mapDialogs.notify(`Käsitelty ${res.processed} havaintoa (${res.failed} epäonnistui).`);
        } catch (e) {
            console.error('Batch exclude encountered an error', e);
            window.mapDialogs.notify('Valinnan käsittely epäonnistui: ' + (e && e.message));
        }
    }
}

/**
 * Function to create a popup content from properties
 * opts: optional object; opts.showConvertBtn = true adds a "Convert to point" button (for polygons)
 */
function createPopupContent(properties, opts) {
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
        content += `<strong>Laji:</strong> ${scientificName}<br>`;
    }
    if (locality) {
        content += `<strong>Paikka:</strong> ${locality}<br>`;
    }
    if (date) {
        content += `<strong>Päivämäärä:</strong> ${date}<br>`;
    }
    if (individualCount) {
        content += `<strong>Lukumäärä:</strong> ${individualCount}<br>`;
    }
    if (recordQuality) {
        content += `<strong>Havainnon laatu:</strong> ${recordQuality}<br>`;
    }
    if (recordBasis) {
        content += `<strong>Havaintotapa:</strong> ${recordBasis}<br>`;
    }
    if (unitID) {
        // Make Unit ID a link to a unit page (opens in a new tab)
        content += `<strong>Havainnon tunniste:</strong> <a href="${unitID}" target="_blank" rel="noopener noreferrer">${unitID}</a><br>`;
    }
    if (team) {
        content += `<strong>Havainnoijat:</strong> ${team}<br>`;
    }
    if (coordinateAccuracy) {
        content += `<strong>Koordinaattien tarkkuus:</strong> ${coordinateAccuracy} m<br>`;
    }
    if (collectionID) {
        // Make Collection ID a link to a collection page (opens in a new tab)
        content += `<strong>Aineiston tunnus:</strong> <a href="${collectionID}" target="_blank" rel="noopener noreferrer">${collectionID}</a><br>`;
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
        const btnLabel = isExcluded ? 'Sisällytä' : 'Piilota';
        const dataExcluded = isExcluded ? '1' : '0';
        content += `<div class="popup-actions"><button class="exclude-btn" data-db-id="${dbId}" data-excluded="${dataExcluded}" onclick="window.toggleExclude(${dbId}, this)">${btnLabel}</button>`;
        if (opts && opts.showConvertBtn) {
            content += ` <button class="convert-to-point-btn" onclick="window.startPolygonToPointConversion(${dbId}); return false;">Muunna pisteeksi</button>`;
        }
        if (opts && opts.showMoveBtn && parseFloat(resolvedProps['gathering.interpretations.coordinateAccuracy']) >= 10) {
            content += ` <button class="move-point-btn" onclick="window.startPointMoveConversion(${dbId}); return false;">Siirrä pistettä</button>`;
        }
        if (resolvedProps._has_modified_geometry) {
            content += ` <button class="restore-geometry-btn" onclick="window.restoreOriginalGeometry(${dbId}); return false;">Palauta alkuperäinen geometria</button>`;
        }
        content += `</div>`;
    }

    content += '</div>';
    return content;
}

/**
 * Returns appropriate popup opts based on the layer's geometry type
 */
function getPopupOpts(layer) {
    if (layer instanceof L.CircleMarker) return { showMoveBtn: true };
    if (layer instanceof L.Polygon) return { showConvertBtn: true };
    return {};
}

/**
 * Create popup content for multiple overlapping features
 */
function createMultiFeaturePopup(features) {
    let content = '<div class="multi-feature-popup">';
    content += `<div class="popup-header"><strong>${features.length} havaintoa tässä sijainnissa</strong></div>`;
    content += `<div class="multi-feature-actions"><button onclick="window.applyMultiFeatureExclude(true)">Piilota kaikki analyysista</button> <button onclick="window.applyMultiFeatureExclude(false)">Sisällytä kaikki analyysiin</button> <button onclick="window.convertMultiFeaturePolygonsToPoints()">Muunna polygonit pisteiksi</button></div>`;

    features.forEach((layer, index) => {
        const props = layer.feature.properties || {};
        const scientificName = props['unit.linkings.taxon.scientificName'] || 'Tuntematon laji';
        const date = props['gathering.displayDateTime'] || 'Ei päivämäärää';
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
        content += createPopupContent(props, getPopupOpts(layer)).replace('<div class="popup-content">', '').replace('</div>', '');
        content += `</div>`;
        
        content += `</div>`;
    });
    
    content += '</div>';
    
    // Store features globally for detail toggle
    window._currentMultiFeatures = features;
    
    return content;
}

/**
 * Setup handler for detecting and displaying multiple overlapping features
 */
function setupMultiFeatureHandler(map, geometryLayer) {
    // Returns true if the click point hits the given layer
    function layerContainsClick(layer, clickLatLng, pixelRadius) {
        try {
            if (layer instanceof L.CircleMarker) {
                const clickPoint = map.latLngToContainerPoint(clickLatLng);
                const layerPoint = map.latLngToContainerPoint(layer.getLatLng());
                return clickPoint.distanceTo(layerPoint) < pixelRadius;
            }
            // Check L.Polygon before L.Polyline because Polygon extends Polyline
            if (layer instanceof L.Polygon) {
                const rings = layer.getLatLngs();
                const outerRing = window.flattenLatLngs(rings.length ? rings[0] : rings);
                return outerRing.length > 0 && window.pointInPolygon(clickLatLng, outerRing);
            }
            if (layer instanceof L.Polyline) {
                const clickPoint = map.latLngToContainerPoint(clickLatLng);
                const pts = window.flattenLatLngs(layer.getLatLngs()).map(ll => map.latLngToContainerPoint(ll));
                for (let i = 0; i < pts.length - 1; i++) {
                    if (window.distToSegment(clickPoint, pts[i], pts[i + 1]) < pixelRadius) return true;
                }
            }
        } catch (e) { /* ignore */ }
        return false;
    }

    geometryLayer.on('click', function(e) {
        const clickLatLng = e.latlng;
        const pixelRadius = 10; // pixels

        const nearbyFeatures = [];
        geometryLayer.eachLayer(function(layer) {
            if (!layer.feature) return;
            if (layerContainsClick(layer, clickLatLng, pixelRadius)) {
                nearbyFeatures.push(layer);
            }
        });

        if (nearbyFeatures.length > 1) {
            const popupContent = createMultiFeaturePopup(nearbyFeatures);
            L.popup()
                .setLatLng(clickLatLng)
                .setContent(popupContent)
                .openOn(map);
        } else if (nearbyFeatures.length === 1) {
            const layer = nearbyFeatures[0];
            const popupContent = createPopupContent(layer.feature.properties || {}, getPopupOpts(layer));
            L.popup()
                .setLatLng(clickLatLng)
                .setContent(popupContent)
                .openOn(map);
        }

        L.DomEvent.stopPropagation(e);
    });
}

/**
 * Bulk exclude/include all features currently shown in the multi-feature popup
 */
window.applyMultiFeatureExclude = async function(exclude) {
    const features = window._currentMultiFeatures;
    if (!features || !features.length) return;
    const dbIds = [];
    features.forEach(function(layer) {
        const props = (layer.feature && layer.feature.properties) || {};
        const id = props._db_id || props.db_id;
        if (id) dbIds.push(id);
    });
    if (!dbIds.length) { window.mapDialogs.notify('Valituissa havainnoissa ei ole tietokantaan tallennettuja havaintoja.'); return; }
    if (!await window.mapDialogs.confirm(`Haluatko ${exclude ? 'piilottaa' : 'sisällyttää'} ${dbIds.length} havaintoa?`)) return;
    try {
        const res = await window.setExcludeBatch(dbIds, exclude);
        if (window.sharedMap) window.sharedMap.closePopup();
        window.mapDialogs.notify(`Käsitelty ${res.processed} havaintoa (${res.failed} epäonnistui).`);
    } catch (e) {
        console.error('Multi-feature exclude error', e);
        window.mapDialogs.notify('Käsittely epäonnistui: ' + (e && e.message));
    }
};

/**
 * Restore original geometry for an observation
 */
window.restoreOriginalGeometry = async function(obsId) {
    if (!await window.mapDialogs.confirm('Haluatko palauttaa havainnon alkuperäisen geometrian?')) return;
    try {
        const res = await fetch('/api/observation/' + obsId + '/restore-original-geometry', { method: 'POST' });
        const data = await res.json().catch(function() { return {}; });
        if (!res.ok || !data.success) throw new Error(data.error || res.statusText || 'request-failed');
        if (window.sharedMap) window.sharedMap.closePopup();
        if (data.restored && typeof window.reloadMapObservations === 'function') await window.reloadMapObservations();
        window.mapDialogs.notify(data.restored ? 'Alkuperäinen geometria palautettiin.' : 'Geometria oli jo alkuperäinen.');
    } catch (e) {
        console.error('Original geometry restore error', e);
        window.mapDialogs.notify('Alkuperäisen geometrian palautus epäonnistui: ' + (e && e.message));
    }
};

/**
 * Convert polygon observations currently shown in the multi-feature popup to points.
 */
window.convertMultiFeaturePolygonsToPoints = async function() {
    const features = window._currentMultiFeatures || [];
    const ids = [...new Set(features
        .filter(function(layer) { return layer instanceof L.Polygon; })
        .map(function(layer) {
            const props = (layer.feature && layer.feature.properties) || {};
            return props._db_id || props.db_id;
        })
        .filter(Boolean))];

    if (!ids.length) {
        window.mapDialogs.notify('Valituissa havainnoissa ei ole polygoneja.');
        return;
    }
    if (!await window.mapDialogs.confirm(`Haluatko muuntaa ${ids.length} polygonihavaintoa pisteiksi? Piste sijoitetaan polygonin sisälle.`)) return;

    try {
        const res = await fetch('/api/observations/convert-polygons-to-points', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: ids })
        });
        const data = await res.json().catch(function() { return {}; });
        if (!res.ok || !data.success) {
            throw new Error(data.error || res.statusText || 'request-failed');
        }

        if (window.sharedMap) window.sharedMap.closePopup();
        if (typeof window.reloadMapObservations === 'function') {
            await window.reloadMapObservations();
        }
        window.mapDialogs.notify(`Muunnettu ${data.processed} polygonihavaintoa pisteiksi.`);
    } catch (e) {
        console.error('Multi-feature polygon conversion error', e);
        window.mapDialogs.notify('Muunnos epäonnistui: ' + (e && e.message));
    }
};

/**
 * Toggle feature details in multi-feature popup
 */
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

/**
 * Function to switch basemap
 * References basemap definitions from map-config.js via window.basemaps
 */
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
