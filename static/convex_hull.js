/* global L */

(function () {
  const map = L.map("map").setView([60.1699, 24.9384], 11);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 22,
    attribution: "&copy; OpenStreetMap contributors",
  }).addTo(map);

  let pointsLayer = null;
  let hullLayer = null;
  let currentPoints = [];
  let db = null;
  let currentDataset = null;

  const els = {
    status: document.getElementById("status"),
    pointCount: document.getElementById("pointCount"),
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

  // Extract coordinates from dataset results
  function extractCoordinates(dataset) {
    const points = [];
    
    if (!dataset || !dataset.data || !dataset.data.results) {
      return points;
    }
    
    dataset.data.results.forEach(result => {
      try {
        // Check if the result has coordinates in the expected format
        const gathering = result.gathering;
        if (gathering && gathering.conversions && gathering.conversions.wgs84CenterPoint) {
          const lat = gathering.conversions.wgs84CenterPoint.lat;
          const lon = gathering.conversions.wgs84CenterPoint.lon;
          
          if (lat && lon && !isNaN(lat) && !isNaN(lon)) {
            points.push([lat, lon]);
          }
        }
      } catch (error) {
        // Skip problematic records
        console.warn('Skipping record due to error:', error);
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

  function createPointsLayer(points) {
    if (pointsLayer) {
      map.removeLayer(pointsLayer);
    }

    const markers = points.map(point => 
      L.circleMarker([point[0], point[1]], {
        radius: 4,
        fillColor: '#3388ff',
        color: '#ffffff',
        weight: 1,
        opacity: 1,
        fillOpacity: 0.8
      })
    );

    pointsLayer = L.layerGroup(markers).addTo(map);
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
    els.pointCount.textContent = points.length;
    
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
      currentPoints = extractCoordinates(dataset);
      
      if (currentPoints.length === 0) {
        setStatus('No coordinates found in this dataset.', 'error');
        return;
      }

      if (currentPoints.length < 3) {
        setStatus(`Only ${currentPoints.length} points found. Need at least 3 points for convex hull.`, 'error');
        return;
      }

      setStatus(`Loaded ${currentPoints.length} points from dataset.`, 'ok');

      // Create convex hull
      const hullPoints = calculateConvexHull(currentPoints);
      
      // Create visualizations
      createPointsLayer(currentPoints);
      createHullLayer(hullPoints);
      
      // Update display
      updateDisplay(currentPoints, hullPoints);
      
      // Fit map to data
      fitMapToData(currentPoints);

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
