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

    return { map, geometryLayer, stats, updateStatus };
};


// Generic paginated observations fetcher. Calls `perFeature(feature)` for
// each feature and `onComplete(meta)` once all pages are processed. Expects
// an `updateStatus` function to display progress.
window.fetchAllObservationsGeneric = async function(datasetId, perFeature, updateStatus, onComplete) {
    updateStatus('Loading observations...');
    try {
        const firstResponse = await fetch(`/api/observations/${datasetId}?page=1&per_page=1000`);
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
                fetch(`/api/observations/${datasetId}?page=${p}&per_page=1000`)
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
    
    // Add Exclude / Include button if this feature references a DB record
    const dbId = properties && (properties['_db_id'] || properties['db_id']);
    const isExcluded = properties && properties['excluded'];
    if (dbId) {
        const btnLabel = isExcluded ? 'Include in analysis' : 'Exclude from analysis';
        const dataExcluded = isExcluded ? '1' : '0';
        content += `<div class="popup-actions"><button class="exclude-btn" data-db-id="${dbId}" data-excluded="${dataExcluded}" onclick="window.toggleExclude(${dbId}, this)">${btnLabel}</button></div>`;
    }

    content += '</div>';
    return content;
}

// Function to add a geometry to a Leaflet feature group
// Returns the created layer(s)
function addGeometryToLayer(geometry, properties, targetLayer) {
    if (!geometry || !geometry.type) {
        return null;
    }
    
    const popupContent = createPopupContent(properties || {});
    
    function addGeometry(geom) {
        const excluded = properties && (properties.excluded === true || properties.excluded === '1' || properties.excluded === 1);
        const defaultColor = '#3388ff';
        const excludedColor = '#ff3333';
        const color = excluded ? excludedColor : defaultColor;

        if (geom.type === 'Point') {
            const marker = L.circleMarker([geom.coordinates[1], geom.coordinates[0]], {
                radius: 5,
                fillColor: color,
                color: '#ffffff',
                weight: 1,
                opacity: 1,
                fillOpacity: 0.8
            });
            marker.bindPopup(popupContent);
            // store properties for later lookup
            marker.feature = marker.feature || {};
            marker.feature.properties = properties || {};
            targetLayer.addLayer(marker);
        } else if (geom.type === 'LineString') {
            const latLngs = geom.coordinates.map(coord => [coord[1], coord[0]]);
            const line = L.polyline(latLngs, {
                color: color,
                weight: 3,
                opacity: 0.8
            });
            line.bindPopup(popupContent);
            line.feature = line.feature || {};
            line.feature.properties = properties || {};
            targetLayer.addLayer(line);
        } else if (geom.type === 'Polygon') {
            const rings = geom.coordinates.map(ring => 
                ring.map(coord => [coord[1], coord[0]])
            );
            const polygon = L.polygon(rings, {
                color: color,
                weight: 2,
                opacity: 0.8,
                fillColor: color,
                fillOpacity: 0.3
            });
            polygon.bindPopup(popupContent);
            polygon.feature = polygon.feature || {};
            polygon.feature.properties = properties || {};
            targetLayer.addLayer(polygon);
        } else if (geom.type === 'MultiPoint') {
            geom.coordinates.forEach(coord => {
                const marker = L.circleMarker([coord[1], coord[0]], {
                    radius: 5,
                    fillColor: color,
                    color: '#ffffff',
                    weight: 1,
                    opacity: 1,
                    fillOpacity: 0.8
                });
                marker.bindPopup(popupContent);
                marker.feature = marker.feature || {};
                marker.feature.properties = properties || {};
                targetLayer.addLayer(marker);
            });
        } else if (geom.type === 'MultiLineString') {
            geom.coordinates.forEach(lineCoords => {
                const latLngs = lineCoords.map(coord => [coord[1], coord[0]]);
                const line = L.polyline(latLngs, {
                    color: color,
                    weight: 3,
                    opacity: 0.8
                });
                line.bindPopup(popupContent);
                line.feature = line.feature || {};
                line.feature.properties = properties || {};
                targetLayer.addLayer(line);
            });
        } else if (geom.type === 'MultiPolygon') {
            geom.coordinates.forEach(polygonCoords => {
                const rings = polygonCoords.map(ring => 
                    ring.map(coord => [coord[1], coord[0]])
                );
                const polygon = L.polygon(rings, {
                    color: color,
                    weight: 2,
                    opacity: 0.8,
                    fillColor: color,
                    fillOpacity: 0.3
                });
                polygon.bindPopup(popupContent);
                polygon.feature = polygon.feature || {};
                polygon.feature.properties = properties || {};
                targetLayer.addLayer(polygon);
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
                            const newColor = data.excluded ? '#ff3333' : '#3388ff';
                            try {
                                if (typeof layer.setStyle === 'function') {
                                    layer.setStyle({ color: newColor, fillColor: newColor });
                                }
                            } catch (e) {
                                // ignore styling errors
                            }
                                // If marker (circleMarker) use setStyle via options or directly set fillColor
                                try {
                                    if (typeof layer.setStyle !== 'function') {
                                        if (typeof layer.setRadius === 'function') {
                                            // circleMarker/marker: update options directly and redraw
                                            if (layer.options) {
                                                layer.options.fillColor = newColor;
                                            }
                                            if (typeof layer.redraw === 'function') layer.redraw();
                                        }
                                    }
                                } catch (e) {
                                    // ignore
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
                                // Request convex hull recalculation without changing map view
                                if (typeof window.createConvexHull === 'function') {
                                    try { window.createConvexHull(false); } catch (e) { /* ignore */ }
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

// Extract all points from geometries (for convex hull calculation, etc.)
function extractAllPoints(geometries) {
    const points = [];
    
    function processGeometry(geom) {
        if (geom.type === 'Point') {
            // GeoJSON format is [lon, lat], convert to [lat, lon]
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
