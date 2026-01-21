/* global L, createSharedMap, fetchAllObservationsGeneric, addGeometryToMap */

// Grids page logic: fetch observations via shared fetcher, build rigid 2km grid
(function () {
  const urlParams = new URLSearchParams(window.location.search);
  const datasetId = urlParams.get('id');

  if (!datasetId) {
    const el = document.getElementById('status');
    if (el) el.textContent = 'Error: No dataset ID provided';
    return;
  }

  const { map, geometryLayer, stats, updateStatus } = createSharedMap('map', [61.0, 25.0], 6);

  let gridLayer = null;
  let lessAccurateLayer = null;

  // Grid / square configuration in EPSG:3067 (meters)
  const SQUARE_SIDE_METERS = 2000; // 2km x 2km squares = 2000m x 2000m
  const HALF_SIDE_METERS = SQUARE_SIDE_METERS / 2;

  const features = [];
  let currentDatasetName = 'Dataset';
  let currentTotal = 0;

  function getPropAccuracy(properties) {
    if (!properties) return undefined;
    // Try flattened key first
    if (properties['gathering.interpretations.coordinateAccuracy'] !== undefined) {
      return Number(properties['gathering.interpretations.coordinateAccuracy']);
    }
    // Try nested
    if (properties.gathering && properties.gathering.interpretations && properties.gathering.interpretations.coordinateAccuracy !== undefined) {
      return Number(properties.gathering.interpretations.coordinateAccuracy);
    }
    return undefined;
  }

  // Returns center in EPSG:3067 [x, y] meters
  function featureCenter3067(feature) {
    if (!feature || !feature.geometry) return null;
    const geom = feature.geometry;
    // Coordinates are already in EPSG:3067 [x, y]
    if (geom.type === 'Point') {
      return [geom.coordinates[0], geom.coordinates[1]];
    }
    // For other types, compute centroid directly in EPSG:3067
    try {
      const pts = [];
      if (geom.type === 'LineString') {
        geom.coordinates.forEach(c => pts.push([c[0], c[1]]));
      } else if (geom.type === 'Polygon') {
        geom.coordinates.forEach(ring => ring.forEach(c => pts.push([c[0], c[1]])));
      } else if (geom.type === 'MultiPoint') {
        geom.coordinates.forEach(c => pts.push([c[0], c[1]]));
      } else if (geom.type === 'MultiLineString') {
        geom.coordinates.forEach(line => line.forEach(c => pts.push([c[0], c[1]])));
      } else if (geom.type === 'MultiPolygon') {
        geom.coordinates.forEach(p => p.forEach(r => r.forEach(c => pts.push([c[0], c[1]]))));
      }
      if (pts.length === 0) return null;
      const avgX = pts.reduce((s, p) => s + p[0], 0) / pts.length;
      const avgY = pts.reduce((s, p) => s + p[1], 0) / pts.length;
      return [avgX, avgY];
    } catch (err) {
      console.warn('Failed to compute center for feature', err);
      return null;
    }

    return null;
  }

  // Calculate 2km x 2km squares centered on each observation in EPSG:3067 (meters)
  // Much simpler than lat/lon! No trigonometry needed.
  function calculateGridSquares(points) {
    const gridSquares = new Map();
    points.forEach(point => {
      if (!point.x || !point.y || isNaN(point.x) || isNaN(point.y)) return;

      // In EPSG:3067, 1km = 1000 meters exactly (no latitude adjustments needed!)
      const x = point.x;
      const y = point.y;

      // If the original feature exists and is larger than the square, skip it
      if (point.geometry) {
        try {
          // Calculate bounding box in EPSG:3067 meters
          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
          function processBounds(geom) {
            if (geom.type === 'Point') {
              minX = Math.min(minX, geom.coordinates[0]);
              maxX = Math.max(maxX, geom.coordinates[0]);
              minY = Math.min(minY, geom.coordinates[1]);
              maxY = Math.max(maxY, geom.coordinates[1]);
            } else if (geom.coordinates) {
              const flatten = (arr) => {
                arr.forEach(item => {
                  if (Array.isArray(item) && typeof item[0] === 'number') {
                    minX = Math.min(minX, item[0]);
                    maxX = Math.max(maxX, item[0]);
                    minY = Math.min(minY, item[1]);
                    maxY = Math.max(maxY, item[1]);
                  } else if (Array.isArray(item)) {
                    flatten(item);
                  }
                });
              };
              flatten(geom.coordinates);
            }
          }
          processBounds(point.geometry);
          const bboxWidth = maxX - minX;
          const bboxHeight = maxY - minY;
          if (bboxWidth > SQUARE_SIDE_METERS || bboxHeight > SQUARE_SIDE_METERS) {
            return; // feature too large
          }
        } catch (e) {
          return; // skip on error
        }
      }

      // Create bounds in EPSG:3067, then we'll transform for display
      const bounds3067 = {
        minX: x - HALF_SIDE_METERS,
        minY: y - HALF_SIDE_METERS,
        maxX: x + HALF_SIDE_METERS,
        maxY: y + HALF_SIDE_METERS
      };

      // Use rounded center as key
      const key = `${x.toFixed(0)},${y.toFixed(0)}`;
      if (!gridSquares.has(key)) {
        gridSquares.set(key, { bounds3067, count: 0, totalWeight: 0, centerX: x, centerY: y });
      }
      const square = gridSquares.get(key);
      square.count++;
      square.totalWeight += point.weight || 1;
    });
    return Array.from(gridSquares.values());
  }

  function checkPolygonOverlap(polygonCoords, accurateGridSquares) {
    if (!polygonCoords || polygonCoords.length < 3) return true;
    const polygon = L.polygon(polygonCoords);
    const polygonBounds = polygon.getBounds();
    for (const gridItem of accurateGridSquares) {
      const gridBoundsArr = Array.isArray(gridItem) ? gridItem : (gridItem && gridItem.bounds ? gridItem.bounds : null);
      if (!gridBoundsArr) continue;
      const gridPolygon = L.polygon(gridBoundsArr);
      const gridBounds = gridPolygon.getBounds();
      if (polygonBounds.intersects(gridBounds)) {
        for (const coord of polygonCoords) if (gridBounds.contains(coord)) return true;
        for (const bound of gridBoundsArr) if (polygonBounds.contains(bound)) return true;
        const polygonCenter = polygon.getBounds().getCenter();
        if (gridBounds.contains(polygonCenter)) return true;
        const gridCenter = gridBounds.getCenter();
        if (polygonBounds.contains(gridCenter)) return true;
      }
    }
    return false;
  }

  function checkPolygonOverlapWithOthers(polygonCoords, otherPolygons) {
    if (!polygonCoords || polygonCoords.length < 3) return true;
    const polygon = L.polygon(polygonCoords);
    const polygonBounds = polygon.getBounds();
    for (const otherCoords of otherPolygons) {
      if (!otherCoords || otherCoords.length < 3) continue;
      const otherPolygon = L.polygon(otherCoords);
      const otherBounds = otherPolygon.getBounds();
      if (polygonBounds.intersects(otherBounds)) {
        for (const coord of polygonCoords) if (otherBounds.contains(coord)) return true;
        for (const coord of otherCoords) if (polygonBounds.contains(coord)) return true;
        const polygonCenter = polygon.getBounds().getCenter();
        if (otherBounds.contains(polygonCenter)) return true;
        const otherCenter = otherBounds.getCenter();
        if (polygonBounds.contains(otherCenter)) return true;
      }
    }
    return false;
  }

  // Helper functions for EPSG:3067 rectangles (in meters)
  function rectsIntersect3067(a, b) {
    return !(a.maxX < b.minX || a.minX > b.maxX || a.maxY < b.minY || a.minY > b.maxY);
  }

  function mergeRects3067(a, b) {
    return {
      minX: Math.min(a.minX, b.minX),
      minY: Math.min(a.minY, b.minY),
      maxX: Math.max(a.maxX, b.maxX),
      maxY: Math.max(a.maxY, b.maxY)
    };
  }

  function dissolveRectangles3067(rects) {
    const out = rects.slice();
    let merged = true;
    while (merged) {
      merged = false;
      outer: for (let i = 0; i < out.length; i++) {
        for (let j = i + 1; j < out.length; j++) {
          if (rectsIntersect3067(out[i], out[j])) {
            out[i] = mergeRects3067(out[i], out[j]);
            out.splice(j, 1);
            merged = true;
            break outer;
          }
        }
      }
    }
    return out;
  }

  function createOrUpdateGrid(accurateGridSquares, lessAccurateRecords, fitMap = true) {
    if (gridLayer) map.removeLayer(gridLayer);
    if (lessAccurateLayer) map.removeLayer(lessAccurateLayer);
    let totalVisibleSquares = 0;

    if (accurateGridSquares.length > 0) {
      // Convert EPSG:3067 bounds to simple rects for dissolving
      const rects3067 = accurateGridSquares.map(sq => ({
        minX: sq.bounds3067.minX,
        minY: sq.bounds3067.minY,
        maxX: sq.bounds3067.maxX,
        maxY: sq.bounds3067.maxY
      }));
      const dissolved = dissolveRectangles3067(rects3067);
      gridLayer = L.layerGroup();
      let totalAreaKm2 = 0;
      dissolved.forEach(rect => {
        // Transform corners to WGS84 for Leaflet display
        const sw = transformToWGS84(rect.minX, rect.minY);
        const se = transformToWGS84(rect.maxX, rect.minY);
        const nw = transformToWGS84(rect.minX, rect.maxY);
        const ne = transformToWGS84(rect.maxX, rect.maxY);
        // Create polygon from transformed corners
        const polygon = L.polygon([sw, se, ne, nw], { color: '#000', weight: 1, fillColor: '#3388ff', fillOpacity: 0.45 });
        gridLayer.addLayer(polygon);
        // Area calculation is trivial in EPSG:3067 (meters)
        const areaM2 = (rect.maxX - rect.minX) * (rect.maxY - rect.minY);
        const areaKm2 = areaM2 / 1000000;
        if (!isNaN(areaKm2) && isFinite(areaKm2) && areaKm2 > 0) totalAreaKm2 += areaKm2;
      });
      gridLayer.addTo(map);
      totalVisibleSquares += dissolved.length;
      try {
        const el = document.getElementById('areaValue');
        if (el) el.textContent = `${totalAreaKm2.toFixed(3)} km²`;
      } catch (e) { /* ignore DOM errors */ }
    }

    if (lessAccurateRecords.length > 0) {
      lessAccurateLayer = L.layerGroup();
      let validLessAccurateCount = 0;
      const validLessAccuratePolygons = [];
      lessAccurateRecords.sort((a, b) => a.accuracy - b.accuracy);
      lessAccurateRecords.forEach((record, index) => {
        try {
          if (!record.polygonCoords) return;
          if (checkPolygonOverlap(record.polygonCoords, accurateGridSquares)) return;
          if (checkPolygonOverlapWithOthers(record.polygonCoords, validLessAccuratePolygons)) return;
          const polygon = L.polygon(record.polygonCoords, { color: '#ff6b35', weight: 2, fillColor: '#ff6b35', fillOpacity: 0.3 });
          const centerInfo = record.center ? `Center: ${record.center.x.toFixed(0)}, ${record.center.y.toFixed(0)} (EPSG:3067)<br>` : '';
          polygon.bindPopup(`${centerInfo}Accuracy: ${record.accuracy}m`);
          lessAccurateLayer.addLayer(polygon);
          validLessAccuratePolygons.push(record.polygonCoords);
          validLessAccurateCount++;
        } catch (err) {
          // skip
        }
      });
      if (validLessAccurateCount > 0) {
        lessAccurateLayer.addTo(map);
        totalVisibleSquares += validLessAccurateCount;
      }
    }

    try {
      const allLayers = [];
      if (gridLayer) allLayers.push(...gridLayer.getLayers());
      if (lessAccurateLayer) allLayers.push(...lessAccurateLayer.getLayers());
      if (fitMap) {
        if (allLayers.length > 0) {
          const group = new L.featureGroup(allLayers);
          const bounds = group.getBounds();
          if (bounds && bounds.isValid()) map.fitBounds(bounds.pad(0.1), { maxZoom: 10 });
          else map.setView([61.0, 25.0], 6);
        } else {
          map.setView([61.0, 25.0], 6);
        }
      }
    } catch (err) {
      if (fitMap) map.setView([61.0, 25.0], 6);
    }

    // Ensure the shared data layer is above grids so data remains clickable
    try {
      if (window.sharedGeometryLayer && typeof window.sharedGeometryLayer.bringToFront === 'function') {
        window.sharedGeometryLayer.bringToFront();
      }
    } catch (e) {
      // ignore
    }

    return totalVisibleSquares;
  }

  // After collecting features, process them
  function processCollectedFeatures(datasetName, total, fitMap = true) {
    updateStatus(`Processing ${datasetName} data...`);
    // Clear background geometry layer and prepare points
    try { if (geometryLayer && typeof geometryLayer.clearLayers === 'function') geometryLayer.clearLayers(); } catch (e) { /* ignore */ }
    const accuratePoints = [];
    const lessAccurateRecords = [];

    features.forEach(feature => {
      const props = feature.properties || {};
      // Always add geometries to the background layer so they are visible behind the grid
      try {
        if (feature.geometry) addGeometryToMap(feature.geometry, props, geometryLayer);
      } catch (e) {
        // ignore geometry add errors
      }

      // For grid calculations, skip excluded features
      const excluded = props && (props.excluded === true || props.excluded === '1' || props.excluded === 1);
      if (excluded) return;

      const accuracy = getPropAccuracy(props);
      const center = featureCenter3067(feature); // Returns [x, y] in EPSG:3067
      if (accuracy !== undefined && accuracy >= 2000) {
        // treat as less accurate if polygon exists
        if (feature.geometry && (feature.geometry.type === 'Polygon' || feature.geometry.type === 'MultiPolygon')) {
          // Polygon coords are already in EPSG:3067, transform to WGS84 for display
          const polygonCoords3067 = feature.geometry.type === 'Polygon'
            ? feature.geometry.coordinates[0]
            : (feature.geometry.coordinates[0] && feature.geometry.coordinates[0][0]) ? feature.geometry.coordinates[0][0] : null;
          const polygonCoordsWGS84 = polygonCoords3067 ? polygonCoords3067.map(c => transformToWGS84(c[0], c[1])) : null;
          lessAccurateRecords.push({ polygonCoords: polygonCoordsWGS84, accuracy, center: center ? { x: center[0], y: center[1] } : null, weight: props['unit.interpretations.individualCount'] || 1 });
        } else if (center) {
          lessAccurateRecords.push({ polygonCoords: null, accuracy, center: { x: center[0], y: center[1] }, weight: props['unit.interpretations.individualCount'] || 1 });
        }
      } else {
        if (center) {
          accuratePoints.push({ x: center[0], y: center[1], weight: props['unit.interpretations.individualCount'] || 1, accuracy: accuracy || 0, geometry: feature.geometry });
        }
      }
    });

    const accurateGridSquares = accuratePoints.length > 0 ? calculateGridSquares(accuratePoints) : [];
    const totalVisible = createOrUpdateGrid(accurateGridSquares, lessAccurateRecords, fitMap);
    updateStatus(`Displaying ${totalVisible} visible squares.`);
  }

  // Use generic fetcher
  fetchAllObservationsGeneric(datasetId,
    (feature) => {
      // collect features; do not automatically add geometries to the map here
      features.push(feature);
    },
    updateStatus,
    ({ datasetName, totalPages, total }) => {
      // process once all pages are fetched
      stats.total = total || stats.total;
      currentDatasetName = datasetName || 'Dataset';
      currentTotal = total || 0;
      // Expose collected features for other modules to update (e.g. exclude toggles)
      window.sharedGridFeatures = features;
      // Initial processing (fit map)
      processCollectedFeatures(currentDatasetName, currentTotal, true);
    }
  );

  // Allow external triggers to recalculate the grid (after includes/excludes)
  window.recalculateGrid = function() {
    try {
      // Recalculate without changing current map view
      processCollectedFeatures(currentDatasetName, currentTotal, false);
    } catch (e) {
      console.error('Error recalculating grid:', e);
    }
  };
})();
