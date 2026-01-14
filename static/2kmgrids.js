/* global L */

(function () {
  // Initialize map with standard WGS84 coordinates
  const map = L.map("map", {
    center: [61.0, 25.0], // Center of Finland
    zoom: 6,
    maxZoom: 12,
    minZoom: 4
  });

  // Add base layer
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 18,
    attribution: "&copy; OpenStreetMap contributors",
  }).addTo(map);

  let gridLayer = null;
  let lessAccurateLayer = null;
  let currentDataset = null;
  let db = null;

  // Grid configuration - 2km rigid grid system
  // Use a reference latitude for consistent grid calculations
  const REFERENCE_LATITUDE = 61.0; // Finland's approximate center latitude
  
  // Calculate fixed grid sizes based on reference latitude
  const GRID_SIZE_LAT_DEGREES = 0.018; // 2km in latitude degrees (constant)
  const GRID_SIZE_LON_DEGREES = (() => {
    // Calculate longitude grid size at reference latitude
    const longitudeKmPerDegree = 111 * Math.cos(REFERENCE_LATITUDE * Math.PI / 180);
    return 2 / longitudeKmPerDegree; // 2km in longitude degrees at reference latitude
  })();
  
  // Grid origin - define a reference point for the grid
  const GRID_ORIGIN_LAT = 60.0; // Grid starts at this latitude
  const GRID_ORIGIN_LON = 20.0; // Grid starts at this longitude

  const els = {
    status: document.getElementById("status"),
  };

  // Initialize IndexedDB (reuse from heatmap)
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

  // Extract WGS84 coordinates from dataset results, separating accurate and less accurate records
  function extractWGS84Coordinates(dataset) {
    const accuratePoints = [];
    const lessAccurateRecords = [];
    
    if (!dataset || !dataset.data || !dataset.data.results) {
      return { accuratePoints, lessAccurateRecords };
    }
    
    console.log(`Processing ${dataset.data.results.length} results for WGS84 coordinates`);
    
    dataset.data.results.forEach((result, index) => {
      try {
        const gathering = result.gathering;
        if (!gathering || !gathering.conversions) {
          return;
        }

        const coordinateAccuracy = gathering.interpretations?.coordinateAccuracy;
        const wgs84CenterPoint = gathering.conversions.wgs84CenterPoint;
        const wgs84WKT = gathering.conversions.wgs84WKT;

        // Check if coordinate accuracy is available and less than 2000 meters (more accurate)
        if (coordinateAccuracy !== undefined && coordinateAccuracy < 2000) {
          if (wgs84CenterPoint && wgs84CenterPoint.lat && wgs84CenterPoint.lon) {
            const lat = parseFloat(wgs84CenterPoint.lat);
            const lon = parseFloat(wgs84CenterPoint.lon);
            
            if (!isNaN(lat) && !isNaN(lon)) {
              const point = {
                lat: lat,
                lon: lon,
                weight: result.gathering?.interpretations?.individualCount || 1,
                accuracy: coordinateAccuracy
              };
              
              accuratePoints.push(point);
            }
          }
        }
        // Check if coordinate accuracy is 2000 meters or higher (less accurate)
        else if (coordinateAccuracy !== undefined && coordinateAccuracy >= 2000) {
          if (wgs84WKT) {
            const record = {
              wgs84WKT: wgs84WKT,
              weight: result.gathering?.interpretations?.individualCount || 1,
              accuracy: coordinateAccuracy,
              centerPoint: wgs84CenterPoint ? {
                lat: parseFloat(wgs84CenterPoint.lat),
                lon: parseFloat(wgs84CenterPoint.lon)
              } : null
            };
            
            lessAccurateRecords.push(record);
          }
        }
        // If no coordinate accuracy is specified, treat as accurate if center point exists
        else if (wgs84CenterPoint && wgs84CenterPoint.lat && wgs84CenterPoint.lon) {
          const lat = parseFloat(wgs84CenterPoint.lat);
          const lon = parseFloat(wgs84CenterPoint.lon);
          
          if (!isNaN(lat) && !isNaN(lon)) {
            const point = {
              lat: lat,
              lon: lon,
              weight: result.gathering?.interpretations?.individualCount || 1,
              accuracy: coordinateAccuracy || 0
            };
            
            accuratePoints.push(point);
          }
        }
      } catch (error) {
        // Skip problematic records
        console.warn('Skipping record due to error:', error);
      }
    });
    
    console.log(`Extracted ${accuratePoints.length} accurate coordinates and ${lessAccurateRecords.length} less accurate records`);
    return { accuratePoints, lessAccurateRecords };
  }

  // Parse WGS84 WKT polygon string to extract coordinates
  function parseWGS84WKT(wktString) {
    try {
      // Extract coordinates from POLYGON WKT format
      // Example: "POLYGON ((28.802685 61.154726, 28.799897 61.156103, ...))"
      const coordMatch = wktString.match(/POLYGON\s*\(\s*\((.*?)\)\s*\)/i);
      if (!coordMatch) {
        console.warn('Invalid WKT format:', wktString);
        return null;
      }
      
      const coordString = coordMatch[1];
      const coordPairs = coordString.split(',').map(pair => pair.trim());
      
      const coordinates = coordPairs.map(pair => {
        const [lon, lat] = pair.split(/\s+/).map(coord => parseFloat(coord));
        return [lat, lon]; // Leaflet expects [lat, lon] format
      });
      
      return coordinates;
    } catch (error) {
      console.warn('Error parsing WKT:', error, wktString);
      return null;
    }
  }

  // Check if a polygon overlaps with any of the accurate grid squares
  function checkPolygonOverlap(polygonCoords, accurateGridSquares) {
    if (!polygonCoords || polygonCoords.length < 3) {
      return true; // Invalid polygon, consider it overlapping to discard
    }
    
    // Create a Leaflet polygon for overlap checking
    const polygon = L.polygon(polygonCoords);
    const polygonBounds = polygon.getBounds();
    
    for (const gridSquare of accurateGridSquares) {
      const gridPolygon = L.polygon(gridSquare.bounds);
      const gridBounds = gridPolygon.getBounds();
      
      // Check if bounding boxes intersect first (faster check)
      if (polygonBounds.intersects(gridBounds)) {
        // If bounding boxes intersect, do a more detailed check
        // Check if any corner of the polygon is inside the grid square
        for (const coord of polygonCoords) {
          if (gridBounds.contains(coord)) {
            return true; // Polygon corner is inside grid square
          }
        }
        
        // Check if any corner of the grid square is inside the polygon
        for (const bound of gridSquare.bounds) {
          if (polygonBounds.contains(bound)) {
            return true; // Grid square corner is inside polygon
          }
        }
        
        // Additional check: if polygon center is inside grid square
        const polygonCenter = polygon.getBounds().getCenter();
        if (gridBounds.contains(polygonCenter)) {
          return true;
        }
        
        // Check if grid square center is inside polygon
        const gridCenter = gridBounds.getCenter();
        if (polygonBounds.contains(gridCenter)) {
          return true;
        }
      }
    }
    
    return false; // No overlap
  }

  // Check if a polygon overlaps with any other polygons
  function checkPolygonOverlapWithOthers(polygonCoords, otherPolygons) {
    if (!polygonCoords || polygonCoords.length < 3) {
      return true; // Invalid polygon, consider it overlapping to discard
    }
    
    // Create a Leaflet polygon for overlap checking
    const polygon = L.polygon(polygonCoords);
    const polygonBounds = polygon.getBounds();
    
    for (const otherCoords of otherPolygons) {
      if (!otherCoords || otherCoords.length < 3) {
        continue; // Skip invalid polygons
      }
      
      const otherPolygon = L.polygon(otherCoords);
      const otherBounds = otherPolygon.getBounds();
      
      // Check if bounding boxes intersect first (faster check)
      if (polygonBounds.intersects(otherBounds)) {
        // If bounding boxes intersect, do a more detailed check
        // Check if any corner of the polygon is inside the other polygon
        for (const coord of polygonCoords) {
          if (otherBounds.contains(coord)) {
            return true; // Polygon corner is inside other polygon
          }
        }
        
        // Check if any corner of the other polygon is inside the polygon
        for (const coord of otherCoords) {
          if (polygonBounds.contains(coord)) {
            return true; // Other polygon corner is inside polygon
          }
        }
        
        // Additional check: if polygon center is inside other polygon
        const polygonCenter = polygon.getBounds().getCenter();
        if (otherBounds.contains(polygonCenter)) {
          return true;
        }
        
        // Check if other polygon center is inside polygon
        const otherCenter = otherBounds.getCenter();
        if (polygonBounds.contains(otherCenter)) {
          return true;
        }
      }
    }
    
    return false; // No overlap
  }

  // Calculate which 2km grid squares contain points
  function calculateGridSquares(points) {
    const gridSquares = new Map();
    
    console.log(`Processing ${points.length} points for rigid 2km grid calculation`);
    console.log(`Grid size: ${GRID_SIZE_LAT_DEGREES}° lat × ${GRID_SIZE_LON_DEGREES.toFixed(6)}° lon`);
    
    points.forEach((point, index) => {
      // Validate point coordinates
      if (!point.lat || !point.lon || isNaN(point.lat) || isNaN(point.lon)) {
        console.warn(`Invalid point at index ${index}:`, point);
        return;
      }
      
      // Calculate which grid square this point belongs to using rigid grid
      // Calculate grid indices relative to the grid origin
      const latIndex = Math.floor((point.lat - GRID_ORIGIN_LAT) / GRID_SIZE_LAT_DEGREES);
      const lonIndex = Math.floor((point.lon - GRID_ORIGIN_LON) / GRID_SIZE_LON_DEGREES);
      
      // Calculate actual grid square coordinates
      const gridLat = GRID_ORIGIN_LAT + latIndex * GRID_SIZE_LAT_DEGREES;
      const gridLon = GRID_ORIGIN_LON + lonIndex * GRID_SIZE_LON_DEGREES;
      
      // Create grid square bounds
      const bounds = [
        [gridLat, gridLon], // Southwest corner
        [gridLat + GRID_SIZE_LAT_DEGREES, gridLon + GRID_SIZE_LON_DEGREES] // Northeast corner
      ];
      
      const key = `${latIndex},${lonIndex}`; // Use indices as key for consistency
      
      if (!gridSquares.has(key)) {
        gridSquares.set(key, {
          bounds: bounds,
          count: 0,
          totalWeight: 0,
          gridLat: gridLat,
          gridLon: gridLon,
          latIndex: latIndex,
          lonIndex: lonIndex
        });
      }
      
      const square = gridSquares.get(key);
      square.count++;
      square.totalWeight += point.weight;
    });
    
    const result = Array.from(gridSquares.values());
    console.log(`Created ${result.length} rigid grid squares with data`);
    return result;
  }

  // Create or update grid visualization
  function createOrUpdateGrid(accurateGridSquares, lessAccurateRecords) {
    // Remove existing layers
    if (gridLayer) {
      map.removeLayer(gridLayer);
    }
    if (lessAccurateLayer) {
      map.removeLayer(lessAccurateLayer);
    }
    
    let totalVisibleSquares = 0;
    
    // Create accurate 2km grid squares
    if (accurateGridSquares.length > 0) {
      console.log(`Creating ${accurateGridSquares.length} accurate grid squares`);
      
      // Create new layer group for accurate grid squares
      gridLayer = L.layerGroup();
      
      // Calculate color scale based on record count
      const maxCount = Math.max(...accurateGridSquares.map(sq => sq.count));
      const minCount = Math.min(...accurateGridSquares.map(sq => sq.count));
      
      console.log(`Accurate record count range: ${minCount} - ${maxCount}`);
      
      accurateGridSquares.forEach((square, index) => {
        // Log first few squares for debugging
        if (index < 3) {
          const latSizeKm = GRID_SIZE_LAT_DEGREES * 111;
          const lonSizeKm = GRID_SIZE_LON_DEGREES * 111 * Math.cos(REFERENCE_LATITUDE * Math.PI / 180);
          console.log(`Accurate Square ${index}:`, {
            bounds: square.bounds,
            count: square.count,
            gridLat: square.gridLat,
            gridLon: square.gridLon,
            latIndex: square.latIndex,
            lonIndex: square.lonIndex,
            actualSizeKm: `${latSizeKm.toFixed(2)}km × ${lonSizeKm.toFixed(2)}km`
          });
        }
        
        // Calculate color intensity based on record count
        const intensity = maxCount > minCount ? 
          (square.count - minCount) / (maxCount - minCount) : 0.5;
        
        // Create color from blue (low) to red (high)
        const red = Math.floor(intensity * 255);
        const blue = Math.floor((1 - intensity) * 255);
        const color = `rgb(${red}, 0, ${blue})`;
        
        // Create rectangle for this grid square
        const rectangle = L.rectangle(square.bounds, {
          color: '#000000',  // Black border for visibility
          weight: 1,         // Border weight
          fillColor: color,
          fillOpacity: 0.6   // Semi-transparent
        });
        
        // Add popup with information
        rectangle.bindPopup(`
          <strong>2km Grid Square (Accurate)</strong><br>
          Records: ${square.count}<br>
          Total Weight: ${square.totalWeight.toFixed(1)}<br>
          Grid Index: (${square.latIndex}, ${square.lonIndex})<br>
          Grid Center: ${(square.gridLat + GRID_SIZE_LAT_DEGREES/2).toFixed(6)}, ${(square.gridLon + GRID_SIZE_LON_DEGREES/2).toFixed(6)}<br>
          Grid Size: ${(GRID_SIZE_LAT_DEGREES * 111).toFixed(1)}km × ${(GRID_SIZE_LON_DEGREES * 111 * Math.cos(REFERENCE_LATITUDE * Math.PI / 180)).toFixed(1)}km
        `);
        
        gridLayer.addLayer(rectangle);
      });
      
      // Add grid layer to map
      gridLayer.addTo(map);
      totalVisibleSquares += accurateGridSquares.length;
    }
    
    // Process less accurate records
    if (lessAccurateRecords.length > 0) {
      console.log(`Processing ${lessAccurateRecords.length} less accurate records`);
      
      // Sort less accurate records by accuracy (most accurate first)
      const sortedLessAccurateRecords = lessAccurateRecords.sort((a, b) => a.accuracy - b.accuracy);
      
      // Create new layer group for less accurate records
      lessAccurateLayer = L.layerGroup();
      
      let validLessAccurateCount = 0;
      const validLessAccuratePolygons = []; // Track valid polygons for overlap checking
      
      sortedLessAccurateRecords.forEach((record, index) => {
        try {
          const polygonCoords = parseWGS84WKT(record.wgs84WKT);
          if (!polygonCoords) {
            return; // Skip invalid polygons
          }
          
          // Check if this polygon overlaps with any accurate grid squares
          if (checkPolygonOverlap(polygonCoords, accurateGridSquares)) {
            console.log(`Discarding less accurate record ${index} (accuracy: ${record.accuracy}m) due to overlap with accurate grid`);
            return; // Skip overlapping polygons
          }
          
          // Check if this polygon overlaps with any other less accurate records already processed
          if (checkPolygonOverlapWithOthers(polygonCoords, validLessAccuratePolygons)) {
            console.log(`Discarding less accurate record ${index} (accuracy: ${record.accuracy}m) due to overlap with other less accurate records`);
            return; // Skip overlapping polygons
          }
          
          // Create polygon for this less accurate record
          const polygon = L.polygon(polygonCoords, {
            color: '#ff6b35',  // Orange border
            weight: 2,
            fillColor: '#ff6b35',
            fillOpacity: 0.3   // More transparent
          });
          
          // Add popup with information
          const centerInfo = record.centerPoint ? 
            `Center: ${record.centerPoint.lat.toFixed(6)}, ${record.centerPoint.lon.toFixed(6)}<br>` : '';
          
          polygon.bindPopup(`
            <strong>Less Accurate Record</strong><br>
            Weight: ${record.weight}<br>
            Accuracy: ${record.accuracy}m<br>
            ${centerInfo}
            Source: WGS84 WKT Polygon
          `);
          
          lessAccurateLayer.addLayer(polygon);
          validLessAccuratePolygons.push(polygonCoords); // Add to valid polygons for future overlap checking
          validLessAccurateCount++;
          
        } catch (error) {
          console.warn(`Error processing less accurate record ${index}:`, error);
        }
      });
      
      // Add less accurate layer to map
      if (validLessAccurateCount > 0) {
        lessAccurateLayer.addTo(map);
        totalVisibleSquares += validLessAccurateCount;
        console.log(`Added ${validLessAccurateCount} non-overlapping less accurate records (sorted by accuracy, most accurate first)`);
      }
    }
    
    // Fit map to show all visible elements
    try {
      const allLayers = [];
      if (gridLayer) allLayers.push(...gridLayer.getLayers());
      if (lessAccurateLayer) allLayers.push(...lessAccurateLayer.getLayers());
      
      if (allLayers.length > 0) {
        const group = new L.featureGroup(allLayers);
        const bounds = group.getBounds();
        
        if (bounds && bounds.isValid()) {
          const paddedBounds = bounds.pad(0.1);
          map.fitBounds(paddedBounds, { maxZoom: 10 });
        } else {
          // Fallback: set a reasonable view of Finland
          map.setView([61.0, 25.0], 6);
        }
      } else {
        // Fallback: set a reasonable view of Finland
        map.setView([61.0, 25.0], 6);
      }
    } catch (error) {
      console.warn('Error fitting bounds:', error);
      map.setView([61.0, 25.0], 6);
    }
    
    return totalVisibleSquares;
  }

  function setStatus(message, type) {
    els.status.textContent = message;
    els.status.className = "stats" + (type ? " " + type : "");
  }

  // Load dataset and initialize grid visualization
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
      const { accuratePoints, lessAccurateRecords } = extractWGS84Coordinates(dataset);
      
      if (accuratePoints.length === 0 && lessAccurateRecords.length === 0) {
        setStatus('No WGS84 coordinates found in this dataset.', 'error');
        return;
      }

      setStatus(`Loaded ${accuratePoints.length} accurate points and ${lessAccurateRecords.length} less accurate records.`, 'ok');
      
      // Process accurate points into 2km grid squares
      const accurateGridSquares = accuratePoints.length > 0 ? calculateGridSquares(accuratePoints) : [];
      
      // Create visualization with both accurate and less accurate records
      const totalVisibleSquares = createOrUpdateGrid(accurateGridSquares, lessAccurateRecords);
      
      setStatus(`Displaying ${totalVisibleSquares} visible squares (${accurateGridSquares.length} accurate + ${totalVisibleSquares - accurateGridSquares.length} less accurate).`, 'ok');

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
