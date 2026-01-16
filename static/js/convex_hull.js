/* global L, addGeometryToLayer, extractAllPoints */

// Get dataset ID from URL
const urlParams = new URLSearchParams(window.location.search);
const datasetId = urlParams.get('id');

if (!datasetId) {
    document.getElementById('status').textContent = 'Error: No dataset ID provided';
    throw new Error('No dataset ID provided');
}

// Create shared map and helpers
const { map, geometryLayer, stats, updateStatus } = createSharedMap();

// Layer for convex hull
let hullLayer = null;

// Store all geometries for convex hull calculation
const allGeometries = [];

// Calculate the convex hull using Graham scan algorithm
function calculateConvexHull(points) {
    if (points.length < 3) {
        return points;
    }

    // Find the bottom-most point (and leftmost in case of tie)
    let start = 0;
    for (let i = 1; i < points.length; i++) {
        if (points[i][0] < points[start][0] || 
            (points[i][0] === points[start][0] && points[i][1] < points[start][1])) {
            start = i;
        }
    }

    // Sort points by polar angle with respect to start point
    const sortedPoints = points.slice();
    sortedPoints.sort((a, b) => {
        const angleA = Math.atan2(a[0] - points[start][0], a[1] - points[start][1]);
        const angleB = Math.atan2(b[0] - points[start][0], b[1] - points[start][1]);
        return angleA - angleB;
    });

    // Graham scan
    const hull = [];
    for (let i = 0; i < sortedPoints.length; i++) {
        while (hull.length > 1 && 
               crossProduct(hull[hull.length - 2], hull[hull.length - 1], sortedPoints[i]) <= 0) {
            hull.pop();
        }
        hull.push(sortedPoints[i]);
    }

    return hull;
}

// Calculate cross product for three points
function crossProduct(o, a, b) {
    return (a[1] - o[1]) * (b[0] - o[0]) - (a[0] - o[0]) * (b[1] - o[1]);
}

// Calculate area of polygon using the shoelace formula
function calculatePolygonArea(points) {
    if (points.length < 3) return 0;

    let area = 0;
    const n = points.length;
    
    for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        area += points[i][1] * points[j][0];
        area -= points[j][1] * points[i][0];
    }
    
    area = Math.abs(area) / 2;
    
    // Convert from square degrees to square kilometers
    const lat = points[0][0];
    const latRad = lat * Math.PI / 180;
    const kmPerDegreeLat = 111.32;
    const kmPerDegreeLon = 111.32 * Math.cos(latRad);
    
    return area * kmPerDegreeLat * kmPerDegreeLon;
}

// Create and display convex hull
function createConvexHull(fitMap = true) {
    if (hullLayer) {
        map.removeLayer(hullLayer);
    }

    // Extract points from visible, non-excluded layers in `geometryLayer`
    const points = [];
    if (geometryLayer && typeof geometryLayer.eachLayer === 'function') {
        geometryLayer.eachLayer(function(layer) {
            try {
                const props = (layer.feature && layer.feature.properties) || layer.feature || {};
                const excluded = props && (props.excluded === true || props.excluded === '1' || props.excluded === 1);
                if (excluded) return;

                // Helper to push latlng objects/arrays to points
                function pushLatLng(latlng) {
                    if (!latlng) return;
                    if (Array.isArray(latlng)) {
                        // [lat, lng]
                        points.push([latlng[0], latlng[1]]);
                    } else if (latlng.lat !== undefined && latlng.lng !== undefined) {
                        points.push([latlng.lat, latlng.lng]);
                    }
                }

                // Flatten nested latlng arrays (polylines/polygons)
                function flattenLatLngs(lls) {
                    if (!lls) return;
                    if (Array.isArray(lls)) {
                        lls.forEach(item => flattenLatLngs(item));
                    } else {
                        pushLatLng(lls);
                    }
                }

                if (typeof layer.getLatLng === 'function') {
                    const ll = layer.getLatLng();
                    pushLatLng(ll);
                } else if (typeof layer.getLatLngs === 'function') {
                    const lls = layer.getLatLngs();
                    flattenLatLngs(lls);
                }
            } catch (e) {
                // ignore layer parsing errors
            }
        });
    } else {
        // Fallback: use previously collected geometries
        points.push(...extractAllPoints(allGeometries));
    }
    
    if (points.length < 3) {
        document.getElementById('areaValue').textContent = 'N/A';
        return;
    }

    // Calculate convex hull
    const hullPoints = calculateConvexHull(points);
    
    // Create hull polygon
    const latLngs = hullPoints.map(point => [point[0], point[1]]);
    hullLayer = L.polygon(latLngs, {
        color: '#ff7800',
        weight: 2,
        opacity: 0.8,
        fillColor: '#ff7800',
        fillOpacity: 0.2
    }).addTo(map);

    // Optionally fit map to hull bounds
    if (fitMap) {
        try {
            const bounds = hullLayer.getBounds();
            if (bounds && bounds.isValid()) map.fitBounds(bounds, { padding: [50, 50] });
        } catch (e) {
            // ignore
        }
    }

    // Ensure the shared data layer is above the hull so features remain clickable
    try {
        if (window.sharedGeometryLayer && typeof window.sharedGeometryLayer.bringToFront === 'function') {
            window.sharedGeometryLayer.bringToFront();
        }
    } catch (e) {
        // ignore
    }

    // Calculate and display area
    const area = calculatePolygonArea(hullPoints);
    document.getElementById('areaValue').textContent = `${area.toFixed(2)} km²`;
}

// Expose for other modules to trigger recalculation (e.g. after exclude toggles)
window.createConvexHull = createConvexHull;

// Function to fetch all pages of data
async function fetchAllObservations() {
    updateStatus('Loading observations...');
    
    let page = 1;
    let totalPages = 1;
    let datasetName = 'Dataset';
    let total = 0;
    
    try {
        // Fetch first page to get metadata
        const firstResponse = await fetch(`/api/observations/${datasetId}?page=1&per_page=1000`);
        if (!firstResponse.ok) {
            throw new Error(`HTTP error! status: ${firstResponse.status}`);
        }

        const firstData = await firstResponse.json();

        if (firstData.features.length === 0) {
            updateStatus('No observations found for this dataset');
            return;
        }

        datasetName = firstData.dataset_name || 'Dataset';
        totalPages = firstData.pagination.pages;
        total = firstData.pagination.total;

        updateStatus(`Loading ${datasetName} (page 1 of ${totalPages})...`);

        // Process first page
        firstData.features.forEach(feature => {
            if (feature.geometry) {
                allGeometries.push(feature.geometry);
                addGeometryToMap(feature.geometry, feature.properties || {}, geometryLayer, stats);
            }
        });

        // Fetch remaining pages
        const fetchPromises = [];
        for (let p = 2; p <= totalPages; p++) {
            fetchPromises.push(
                fetch(`/api/observations/${datasetId}?page=${p}&per_page=1000`)
                    .then(response => response.json())
                    .then(data => {
                        updateStatus(`Loading ${datasetName} (page ${p} of ${totalPages})...`);
                        data.features.forEach(feature => {
                            if (feature.geometry) {
                                allGeometries.push(feature.geometry);
                                addGeometryToMap(feature.geometry, feature.properties || {}, geometryLayer, stats);
                            }
                        });
                    })
            );
        }

        // Wait for all pages to load
        await Promise.all(fetchPromises);

        // Create convex hull after all geometries are loaded (fit map)
        createConvexHull(true);

        // Display final statistics (simplified)
        const statusMessage = `${datasetName}: ${stats.total} observations loaded with convex hull` +
            (stats.skipped > 0 ? ` | Skipped: ${stats.skipped}` : '');

        updateStatus(statusMessage);

    } catch (error) {
        console.error('Error fetching observations:', error);
        updateStatus(`Error loading data: ${error.message}`);
    }
}

// Start loading data when page loads
// Use generic fetcher and create hull once loaded
fetchAllObservationsGeneric(datasetId,
    (feature) => {
        if (feature.geometry) {
            allGeometries.push(feature.geometry);
            addGeometryToMap(feature.geometry, feature.properties || {}, geometryLayer, stats);
        }
    },
    updateStatus,
    ({ datasetName, total }) => {
        stats.total = total || stats.total;
        createConvexHull(true);

        const statusMessage = `${datasetName}: ${stats.total} observations loaded` +
            (stats.skipped > 0 ? ` | Skipped: ${stats.skipped}` : '');

        updateStatus(statusMessage);
    }
);
