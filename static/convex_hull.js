/* global L */

(function () {
  const map = L.map("map").setView([60.1699, 24.9384], 11);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 22,
    attribution: "&copy; OpenStreetMap contributors",
  }).addTo(map);

  let geometriesLayer = null;
  let hullLayer = null;
  let currentGeometries = [];
  let db = null;
  let currentDataset = null;

  const els = {
    status: document.getElementById("status"),
    areaValue: document.getElementById("areaValue"),
  };

  // Initialize IndexedDB
  function initDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('BioToolsDatasets', 1);
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        db = request.result;
        resolve();
      };
      
      request.onupgradeneeded = (event) => {
        const database = event.target.result;
        if (!database.objectStoreNames.contains('datasets')) {
          const store = database.createObjectStore('datasets', { keyPath: 'id' });
          store.createIndex('timestamp', 'timestamp', { unique: false });
          store.createIndex('url', 'url', { unique: false });
          store.createIndex('hash', 'hash', { unique: false });
        }
      };
    });
  }

  // Get dataset ID from URL parameters
  function getDatasetId() {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('id');
  }

  // Load dataset from IndexedDB
  async function loadDataset(datasetId) {
    try {
      const transaction = db.transaction(['datasets'], 'readonly');
      const store = transaction.objectStore('datasets');
      const request = store.get(datasetId);
      
      return new Promise((resolve) => {
        request.onsuccess = () => {
          resolve(request.result || null);
        };
        request.onerror = () => {
          resolve(null);
        };
      });
    } catch (error) {
      console.error('Error loading dataset:', error);
      return null;
    }
  }

  // Parse WKT (Well-Known Text) geometry and preserve original structure
  function parseWKT(wkt) {
    if (!wkt || typeof wkt !== 'string') {
      return null;
    }
    
    try {
      const typeMatch = wkt.match(/^([A-Z]+)\s*\(/i);
      if (!typeMatch) {
        return null;
      }
      
      const geometryType = typeMatch[1].toUpperCase();
      const coordString = wkt.replace(/^[A-Z]+\s*\(/i, '').replace(/\)$/, '');
      
      // Parse based on geometry type
      if (geometryType === 'POINT') {
        const coords = coordString.trim().split(/\s+/);
        if (coords.length >= 2) {
          const lon = parseFloat(coords[0]);
          const lat = parseFloat(coords[1]);
          if (!isNaN(lat) && !isNaN(lon)) {
            return { type: 'Point', coordinates: [lat, lon] };
          }
        }
      } else if (geometryType === 'LINESTRING') {
        const points = [];
        const pairs = coordString.split(',');
        pairs.forEach(pair => {
          const coords = pair.trim().split(/\s+/);
          if (coords.length >= 2) {
            const lon = parseFloat(coords[0]);
            const lat = parseFloat(coords[1]);
            if (!isNaN(lat) && !isNaN(lon)) {
              points.push([lat, lon]);
            }
          }
        });
        return { type: 'LineString', coordinates: points };
      } else if (geometryType === 'POLYGON') {
        const rings = [];
        // Handle nested parentheses for polygon rings
        let depth = 0;
        let currentRing = '';
        
        for (let i = 0; i < coordString.length; i++) {
          const char = coordString[i];
          if (char === '(') {
            depth++;
            if (depth === 1) continue; // Skip outer parenthesis
          } else if (char === ')') {
            depth--;
            if (depth === 0) {
              // Parse the ring
              const points = [];
              const pairs = currentRing.split(',');
              pairs.forEach(pair => {
                const coords = pair.trim().split(/\s+/);
                if (coords.length >= 2) {
                  const lon = parseFloat(coords[0]);
                  const lat = parseFloat(coords[1]);
                  if (!isNaN(lat) && !isNaN(lon)) {
                    points.push([lat, lon]);
                  }
                }
              });
              if (points.length > 0) {
                rings.push(points);
              }
              currentRing = '';
              continue;
            }
          } else if (depth > 0) {
            currentRing += char;
          }
        }
        return { type: 'Polygon', coordinates: rings };
      }
    } catch (error) {
      console.warn('Error parsing WKT:', error);
    }
    
    return null;
  }

  // Extract geometries from dataset results
  function extractGeometries(dataset) {
    const geometries = [];
    
    if (!dataset || !dataset.data) {
      return geometries;
    }
    
    // Support both features (GeoJSON) and results formats
    const records = dataset.data.features || dataset.data.results || [];
    
    records.forEach(record => {
      try {
        const props = record.properties || {};
        
        // Get WKT geometry (supports points, polygons, lines)
        const wkt = props['gathering.conversions.wgs84WKT'];
        if (wkt) {
          const geometry = parseWKT(wkt);
          if (geometry) {
            geometries.push(geometry);
          }
        }
      } catch (error) {
        // Skip problematic records
        console.warn('Skipping record due to error:', error);
      }
    });
    
    return geometries;
  }
  
  // Extract all points from geometries for convex hull calculation
  function extractAllPoints(geometries) {
    const points = [];
    
    geometries.forEach(geom => {
      if (geom.type === 'Point') {
        points.push(geom.coordinates);
      } else if (geom.type === 'LineString') {
        points.push(...geom.coordinates);
      } else if (geom.type === 'Polygon') {
        geom.coordinates.forEach(ring => {
          points.push(...ring);
        });
      }
    });
    
    return points;
  }

  function setStatus(message, type) {
    els.status.textContent = message;
    els.status.className = "stats" + (type ? " " + type : "");
  }

  // Calculate the convex hull using Graham scan algorithm
  function calculateConvexHull(points) {
    if (points.length < 3) {
      return points; // Need at least 3 points for a convex hull
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
    // This is an approximation - for more accuracy, we'd need to account for latitude
    const lat = points[0][0]; // Use first point's latitude for approximation
    const latRad = lat * Math.PI / 180;
    const kmPerDegreeLat = 111.32; // km per degree latitude
    const kmPerDegreeLon = 111.32 * Math.cos(latRad); // km per degree longitude at this latitude
    
    return area * kmPerDegreeLat * kmPerDegreeLon;
  }

  function createGeometriesLayer(geometries) {
    if (geometriesLayer) {
      map.removeLayer(geometriesLayer);
    }

    const layers = [];
    
    geometries.forEach(geom => {
      if (geom.type === 'Point') {
        layers.push(L.circleMarker([geom.coordinates[0], geom.coordinates[1]], {
          radius: 5,
          fillColor: '#3388ff',
          color: '#ffffff',
          weight: 1,
          opacity: 1,
          fillOpacity: 0.8
        }));
      } else if (geom.type === 'LineString') {
        const latLngs = geom.coordinates.map(coord => [coord[0], coord[1]]);
        layers.push(L.polyline(latLngs, {
          color: '#3388ff',
          weight: 3,
          opacity: 0.8
        }));
      } else if (geom.type === 'Polygon') {
        const rings = geom.coordinates.map(ring => 
          ring.map(coord => [coord[0], coord[1]])
        );
        layers.push(L.polygon(rings, {
          color: '#3388ff',
          weight: 2,
          opacity: 0.8,
          fillColor: '#3388ff',
          fillOpacity: 0.3
        }));
      }
    });

    geometriesLayer = L.layerGroup(layers).addTo(map);
  }

  function createHullLayer(hullPoints) {
    if (hullLayer) {
      map.removeLayer(hullLayer);
    }

    if (hullPoints.length < 3) return;

    // Convert points to Leaflet format
    const latLngs = hullPoints.map(point => [point[0], point[1]]);
    
    hullLayer = L.polygon(latLngs, {
      color: '#ff7800',
      weight: 2,
      opacity: 0.8,
      fillColor: '#ff7800',
      fillOpacity: 0.2
    }).addTo(map);
  }

  function updateDisplay(points, hullPoints) {
    if (hullPoints.length >= 3) {
      const area = calculatePolygonArea(hullPoints);
      els.areaValue.textContent = `${area.toFixed(2)} km²`;
    } else {
      els.areaValue.textContent = 'N/A';
    }
  }

  function fitMapToData(points) {
    if (points.length === 0) return;

    const lats = points.map(p => p[0]);
    const lngs = points.map(p => p[1]);
    const bounds = L.latLngBounds(
      [Math.min(...lats), Math.min(...lngs)],
      [Math.max(...lats), Math.max(...lngs)]
    );
    
    if (bounds.isValid()) {
      map.fitBounds(bounds.pad(0.1));
    }
  }

  // Load dataset and initialize visualization
  async function loadDatasetAndInitialize() {
    try {
      const datasetId = getDatasetId();
      if (!datasetId) {
        setStatus('No dataset ID provided. Please select a dataset from the Simple Parser page.', 'error');
        return;
      }

      setStatus('Loading dataset...', 'loading');

      const dataset = await loadDataset(datasetId);
      if (!dataset) {
        setStatus('Dataset not found.', 'error');
        return;
      }

      currentDataset = dataset;
      currentGeometries = extractGeometries(dataset);
      
      if (currentGeometries.length === 0) {
        setStatus('No geometries found in this dataset.', 'error');
        return;
      }

      setStatus(`Loaded ${currentGeometries.length} geometries from dataset.`, 'ok');

      // Extract points for calculations
      const points = extractAllPoints(currentGeometries);
      const hullPoints = calculateConvexHull(points);
      
      // Create visualizations
      createGeometriesLayer(currentGeometries);
      createHullLayer(hullPoints);
      updateDisplay(points, hullPoints);
      fitMapToData(points);

    } catch (error) {
      console.error('Error loading dataset:', error);
      setStatus(`Error: ${error.message}`, 'error');
    }
  }

  // Initialize the app
  document.addEventListener('DOMContentLoaded', async function() {
    try {
      await initDB();
      await loadDatasetAndInitialize();
    } catch (error) {
      console.error('Failed to initialize app:', error);
      setStatus('Failed to initialize database', 'error');
    }
  });
})();
