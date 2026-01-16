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

// Function to add a single feature to map (stores geometry for hull)
function addGeometryToMap(geometry, properties) {
    if (!geometry || !geometry.type) {
        stats.skipped++;
        return;
    }

    try {
        switch (geometry.type) {
            case 'Point':
                stats.points++;
                break;
            case 'LineString':
                stats.linestrings++;
                break;
            case 'Polygon':
                stats.polygons++;
                break;
            case 'MultiPoint':
                stats.multipoints++;
                break;
            case 'MultiLineString':
                stats.multilinestrings++;
                break;
            case 'MultiPolygon':
                stats.multipolygons++;
                break;
            case 'GeometryCollection':
                stats.geometrycollections++;
                if (geometry.geometries && Array.isArray(geometry.geometries)) {
                    geometry.geometries.forEach(geom => addGeometryToMap(geom, properties));
                }
                allGeometries.push(geometry);
                return;
            default:
                console.warn('Unknown geometry type:', geometry.type);
                stats.skipped++;
                return;
        }

        stats.total++;
        allGeometries.push(geometry);

        addGeometryToLayer(geometry, properties, geometryLayer);
    } catch (error) {
        console.error('Error adding geometry to map:', error, geometry);
    }
}

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
function createConvexHull() {
    if (hullLayer) {
        map.removeLayer(hullLayer);
    }

    // Extract all points from geometries
    const points = extractAllPoints(allGeometries);
    
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

    // Calculate and display area
    const area = calculatePolygonArea(hullPoints);
    document.getElementById('areaValue').textContent = `${area.toFixed(2)} km²`;
}

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
                addGeometryToMap(feature.geometry, feature.properties || {});
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
                                addGeometryToMap(feature.geometry, feature.properties || {});
                            }
                        });
                    })
            );
        }
        
        // Wait for all pages to load
        await Promise.all(fetchPromises);
        
        // Create convex hull after all geometries are loaded
        createConvexHull();
        
        // Fit map to show all geometries
        const bounds = geometryLayer.getBounds();
        if (bounds.isValid()) {
            map.fitBounds(bounds, { padding: [50, 50] });
        }
        
        // Display final statistics (match map.js format)
        const statusMessage = `${datasetName}: ${total} observations loaded with convex hull | ` +
            `Points: ${stats.points} | Lines: ${stats.linestrings} | Polygons: ${stats.polygons} | ` +
            `MultiPoints: ${stats.multipoints} | MultiLines: ${stats.multilinestrings} | ` +
            `MultiPolygons: ${stats.multipolygons} | GeometryCollections: ${stats.geometrycollections}` +
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
        if (feature.geometry) addGeometryToMap(feature.geometry, feature.properties || {});
    },
    updateStatus,
    ({ datasetName, total }) => {
        stats.total = total || stats.total;
        createConvexHull();

        const bounds = geometryLayer.getBounds();
        if (bounds.isValid()) map.fitBounds(bounds, { padding: [50, 50] });

        const statusMessage = `${datasetName}: ${stats.total} observations loaded with convex hull | ` +
            `Points: ${stats.points} | Lines: ${stats.linestrings} | Polygons: ${stats.polygons} | ` +
            `MultiPoints: ${stats.multipoints} | MultiLines: ${stats.multilinestrings} | ` +
            `MultiPolygons: ${stats.multipolygons} | GeometryCollections: ${stats.geometrycollections}` +
            (stats.skipped > 0 ? ` | Skipped: ${stats.skipped}` : '');

        updateStatus(statusMessage);
    }
);
