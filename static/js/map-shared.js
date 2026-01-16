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
        if (geom.type === 'Point') {
            const marker = L.circleMarker([geom.coordinates[1], geom.coordinates[0]], {
                radius: 5,
                fillColor: '#3388ff',
                color: '#ffffff',
                weight: 1,
                opacity: 1,
                fillOpacity: 0.8
            });
            marker.bindPopup(popupContent);
            targetLayer.addLayer(marker);
        } else if (geom.type === 'LineString') {
            const latLngs = geom.coordinates.map(coord => [coord[1], coord[0]]);
            const line = L.polyline(latLngs, {
                color: '#3388ff',
                weight: 3,
                opacity: 0.8
            });
            line.bindPopup(popupContent);
            targetLayer.addLayer(line);
        } else if (geom.type === 'Polygon') {
            const rings = geom.coordinates.map(ring => 
                ring.map(coord => [coord[1], coord[0]])
            );
            const polygon = L.polygon(rings, {
                color: '#3388ff',
                weight: 2,
                opacity: 0.8,
                fillColor: '#3388ff',
                fillOpacity: 0.3
            });
            polygon.bindPopup(popupContent);
            targetLayer.addLayer(polygon);
        } else if (geom.type === 'MultiPoint') {
            geom.coordinates.forEach(coord => {
                const marker = L.circleMarker([coord[1], coord[0]], {
                    radius: 5,
                    fillColor: '#3388ff',
                    color: '#ffffff',
                    weight: 1,
                    opacity: 1,
                    fillOpacity: 0.8
                });
                marker.bindPopup(popupContent);
                targetLayer.addLayer(marker);
            });
        } else if (geom.type === 'MultiLineString') {
            geom.coordinates.forEach(lineCoords => {
                const latLngs = lineCoords.map(coord => [coord[1], coord[0]]);
                const line = L.polyline(latLngs, {
                    color: '#3388ff',
                    weight: 3,
                    opacity: 0.8
                });
                line.bindPopup(popupContent);
                targetLayer.addLayer(line);
            });
        } else if (geom.type === 'MultiPolygon') {
            geom.coordinates.forEach(polygonCoords => {
                const rings = polygonCoords.map(ring => 
                    ring.map(coord => [coord[1], coord[0]])
                );
                const polygon = L.polygon(rings, {
                    color: '#3388ff',
                    weight: 2,
                    opacity: 0.8,
                    fillColor: '#3388ff',
                    fillOpacity: 0.3
                });
                polygon.bindPopup(popupContent);
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
