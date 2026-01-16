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

  // Grid configuration (approx 2km squares)
  const REFERENCE_LATITUDE = 61.0;
  const GRID_SIZE_LAT_DEGREES = 0.018; // ~2 km in latitude degrees
  const GRID_SIZE_LON_DEGREES = (() => {
    const kmPerDegLon = 111.32 * Math.cos(REFERENCE_LATITUDE * Math.PI / 180);
    return 2 / kmPerDegLon;
  })();
  const GRID_ORIGIN_LAT = 60.0;
  const GRID_ORIGIN_LON = 20.0;

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

  function calculateGridSquares(points) {
    const gridSquares = new Map();
    points.forEach(point => {
      if (!point.lat || !point.lon || isNaN(point.lat) || isNaN(point.lon)) return;
      const latIndex = Math.floor((point.lat - GRID_ORIGIN_LAT) / GRID_SIZE_LAT_DEGREES);
      const lonIndex = Math.floor((point.lon - GRID_ORIGIN_LON) / GRID_SIZE_LON_DEGREES);
      const gridLat = GRID_ORIGIN_LAT + latIndex * GRID_SIZE_LAT_DEGREES;
      const gridLon = GRID_ORIGIN_LON + lonIndex * GRID_SIZE_LON_DEGREES;
      const bounds = [[gridLat, gridLon], [gridLat + GRID_SIZE_LAT_DEGREES, gridLon + GRID_SIZE_LON_DEGREES]];
      const key = `${latIndex},${lonIndex}`;
      if (!gridSquares.has(key)) {
        gridSquares.set(key, { bounds, count: 0, totalWeight: 0, gridLat, gridLon, latIndex, lonIndex });
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
    for (const gridSquare of accurateGridSquares) {
      const gridPolygon = L.polygon(gridSquare.bounds);
      const gridBounds = gridPolygon.getBounds();
      if (polygonBounds.intersects(gridBounds)) {
        for (const coord of polygonCoords) if (gridBounds.contains(coord)) return true;
        for (const bound of gridSquare.bounds) if (polygonBounds.contains(bound)) return true;
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

  function createOrUpdateGrid(accurateGridSquares, lessAccurateRecords, fitMap = true) {
    if (gridLayer) map.removeLayer(gridLayer);
    if (lessAccurateLayer) map.removeLayer(lessAccurateLayer);
    let totalVisibleSquares = 0;

    if (accurateGridSquares.length > 0) {
      gridLayer = L.layerGroup();
      const maxCount = Math.max(...accurateGridSquares.map(sq => sq.count));
      const minCount = Math.min(...accurateGridSquares.map(sq => sq.count));
      accurateGridSquares.forEach((square, index) => {
        const intensity = maxCount > minCount ? (square.count - minCount) / (maxCount - minCount) : 0.5;
        const red = Math.floor(intensity * 255);
        const blue = Math.floor((1 - intensity) * 255);
        const color = `rgb(${red},0,${blue})`;
        const rectangle = L.rectangle(square.bounds, { color: '#000', weight: 1, fillColor: color, fillOpacity: 0.6 });
        rectangle.bindPopup(`Records: ${square.count}<br>Total weight: ${square.totalWeight.toFixed(1)}`);
        gridLayer.addLayer(rectangle);
      });
      gridLayer.addTo(map);
      totalVisibleSquares += accurateGridSquares.length;
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
          accuratePoints.push({ lat: center[0], lon: center[1], weight: props['unit.interpretations.individualCount'] || 1, accuracy: accuracy || 0 });
        }
      }
    });

    const accurateGridSquares = accuratePoints.length > 0 ? calculateGridSquares(accuratePoints) : [];
    const totalVisible = createOrUpdateGrid(accurateGridSquares, lessAccurateRecords, fitMap);
    updateStatus(`Displaying ${totalVisible} visible squares (${accurateGridSquares.length} accurate).`);
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
