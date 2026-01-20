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

  // Grid / square configuration
  const KM_PER_DEG_LAT = 111.32; // approx km per degree latitude
  const SQUARE_SIDE_KM = 2; // 2km x 2km squares
  const HALF_SIDE_KM = SQUARE_SIDE_KM / 2;

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

  function featureCenterLatLon(feature) {
    if (!feature || !feature.geometry) return null;
    const geom = feature.geometry;
    // GeoJSON coordinates are [lon, lat]
    if (geom.type === 'Point') {
      return [geom.coordinates[1], geom.coordinates[0]];
    }
    // For LineString/Polygon, use Leaflet to compute center
    try {
      if (geom.type === 'LineString') {
        const latlngs = geom.coordinates.map(c => [c[1], c[0]]);
        const poly = L.polyline(latlngs);
        const center = poly.getBounds().getCenter();
        return [center.lat, center.lng];
      }
      if (geom.type === 'Polygon') {
        const rings = geom.coordinates.map(r => r.map(c => [c[1], c[0]]));
        const poly = L.polygon(rings);
        const center = poly.getBounds().getCenter();
        return [center.lat, center.lng];
      }
      if (geom.type === 'MultiPoint' || geom.type === 'MultiLineString' || geom.type === 'MultiPolygon') {
        // Compute centroid of all points
        const pts = [];
        if (geom.type === 'MultiPoint') {
          geom.coordinates.forEach(c => pts.push([c[1], c[0]]));
        } else if (geom.type === 'MultiLineString') {
          geom.coordinates.forEach(line => line.forEach(c => pts.push([c[1], c[0]])));
        } else if (geom.type === 'MultiPolygon') {
          geom.coordinates.forEach(p => p.forEach(r => r.forEach(c => pts.push([c[1], c[0]]))));
        }
        if (pts.length === 0) return null;
        const avgLat = pts.reduce((s, p) => s + p[0], 0) / pts.length;
        const avgLon = pts.reduce((s, p) => s + p[1], 0) / pts.length;
        return [avgLat, avgLon];
      }
    } catch (err) {
      console.warn('Failed to compute center for feature', err);
      return null;
    }

    return null;
  }

  // Calculate 2km x 2km squares centered on each observation center.
  // Skip features whose bounding box is larger than the square.
  function calculateGridSquares(points) {
    const gridSquares = new Map();
    points.forEach(point => {
      if (!point.lat || !point.lon || isNaN(point.lat) || isNaN(point.lon)) return;

      // Compute degree offsets for 1 km (half-side) at this latitude
      const lat = point.lat;
      const halfLatDeg = HALF_SIDE_KM / KM_PER_DEG_LAT;
      const kmPerDegLon = KM_PER_DEG_LAT * Math.cos(lat * Math.PI / 180);
      const halfLonDeg = HALF_SIDE_KM / (kmPerDegLon || KM_PER_DEG_LAT);

      // If the original feature exists and is larger than the square, skip it
      if (point.geometry) {
        try {
          const layer = L.geoJSON(point.geometry);
          const b = layer.getBounds();
          const bboxHeightMeters = (b.getNorth() - b.getSouth()) * KM_PER_DEG_LAT * 1000;
          const midLat = (b.getNorth() + b.getSouth()) / 2;
          const bboxWidthMeters = (b.getEast() - b.getWest()) * KM_PER_DEG_LAT * 1000 * Math.cos(midLat * Math.PI / 180);
          if (bboxHeightMeters > SQUARE_SIDE_KM * 1000 || bboxWidthMeters > SQUARE_SIDE_KM * 1000) {
            return; // feature too large to represent as 2km square
          }
        } catch (e) {
          // if any error, be conservative and skip drawing
          return;
        }
      }

      const bounds = [[lat - halfLatDeg, point.lon - halfLonDeg], [lat + halfLatDeg, point.lon + halfLonDeg]];

      // Use rounded center as key to aggregate overlapping identical centers
      const key = `${point.lat.toFixed(6)},${point.lon.toFixed(6)}`;
      if (!gridSquares.has(key)) {
        gridSquares.set(key, { bounds, count: 0, totalWeight: 0, centerLat: lat, centerLon: point.lon });
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

  // Helper to test intersection and merge axis-aligned rectangles defined by bounds arrays
  function rectsIntersect(a, b) {
    // a and b are [[south, west], [north, east]]
    const aS = a[0][0], aW = a[0][1], aN = a[1][0], aE = a[1][1];
    const bS = b[0][0], bW = b[0][1], bN = b[1][0], bE = b[1][1];
    return !(aE < bW || aW > bE || aN < bS || aS > bN);
  }

  function mergeRects(a, b) {
    const s = Math.min(a[0][0], b[0][0]);
    const w = Math.min(a[0][1], b[0][1]);
    const n = Math.max(a[1][0], b[1][0]);
    const e = Math.max(a[1][1], b[1][1]);
    return [[s, w], [n, e]];
  }

  function dissolveRectangles(rects) {
    const out = rects.slice();
    let merged = true;
    while (merged) {
      merged = false;
      outer: for (let i = 0; i < out.length; i++) {
        for (let j = i + 1; j < out.length; j++) {
          if (rectsIntersect(out[i], out[j])) {
            out[i] = mergeRects(out[i], out[j]);
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
      // accurateGridSquares is array of bounds arrays ([[s,w],[n,e]])
      const rects = accurateGridSquares.map(sq => sq.bounds ? sq.bounds : sq);
      const dissolved = dissolveRectangles(rects);
      gridLayer = L.layerGroup();
      // compute total area of dissolved grid polygons (approximate, in km^2)
      let totalAreaKm2 = 0;
      dissolved.forEach(boundsArr => {
        const rectangle = L.rectangle(boundsArr, { color: '#000', weight: 1, fillColor: '#3388ff', fillOpacity: 0.45 });
        gridLayer.addLayer(rectangle);
        try {
          const south = boundsArr[0][0];
          const west = boundsArr[0][1];
          const north = boundsArr[1][0];
          const east = boundsArr[1][1];
          const deltaLatDeg = Math.abs(north - south);
          const deltaLonDeg = Math.abs(east - west);
          const meanLat = (north + south) / 2;
          const areaKm2 = deltaLatDeg * deltaLonDeg * KM_PER_DEG_LAT * KM_PER_DEG_LAT * Math.cos(meanLat * Math.PI / 180);
          if (!isNaN(areaKm2) && isFinite(areaKm2) && areaKm2 > 0) totalAreaKm2 += areaKm2;
        } catch (e) {
          // ignore area calc errors for this rectangle
        }
      });
      gridLayer.addTo(map);
      totalVisibleSquares += dissolved.length;
      // Update dataset info area element if present
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
          const centerInfo = record.center ? `Center: ${record.center.lat.toFixed(6)}, ${record.center.lon.toFixed(6)}<br>` : '';
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
      const center = featureCenterLatLon(feature);
      if (accuracy !== undefined && accuracy >= 2000) {
        // treat as less accurate if polygon exists
        if (feature.geometry && (feature.geometry.type === 'Polygon' || feature.geometry.type === 'MultiPolygon')) {
          // convert polygon coords to [lat,lon]
          const polygonCoords = feature.geometry.type === 'Polygon'
            ? feature.geometry.coordinates[0].map(c => [c[1], c[0]])
            : // MultiPolygon take first polygon
              (feature.geometry.coordinates[0] && feature.geometry.coordinates[0][0]) ? feature.geometry.coordinates[0][0].map(c => [c[1], c[0]]) : null;
          lessAccurateRecords.push({ polygonCoords, accuracy, center: center ? { lat: center[0], lon: center[1] } : null, weight: props['unit.interpretations.individualCount'] || 1 });
        } else if (center) {
          lessAccurateRecords.push({ polygonCoords: null, accuracy, center: { lat: center[0], lon: center[1] }, weight: props['unit.interpretations.individualCount'] || 1 });
        }
      } else {
        if (center) {
            accuratePoints.push({ lat: center[0], lon: center[1], weight: props['unit.interpretations.individualCount'] || 1, accuracy: accuracy || 0, geometry: feature.geometry });
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
