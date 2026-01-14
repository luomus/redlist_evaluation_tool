/* global L */

(function () {
  const map = L.map("map").setView([60.1699, 24.9384], 11);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 22,
    attribution: "&copy; OpenStreetMap contributors",
  }).addTo(map);

  let heatLayer = null;
  let currentPoints = [];
  let db = null;
  let currentDataset = null;

  const els = {
    status: document.getElementById("status"),
    radius: document.getElementById("radius"),
    radiusVal: document.getElementById("radiusVal"),
    blur: document.getElementById("blur"),
    blurVal: document.getElementById("blurVal"),
    maxZoom: document.getElementById("maxZoom"),
    maxIntensity: document.getElementById("maxIntensity"),
    minOpacity: document.getElementById("minOpacity"),
    minOpacityVal: document.getElementById("minOpacityVal"),
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

  // Save heatmap settings to localStorage
  function saveSettings() {
    const settings = {
      radius: Number(els.radius.value),
      blur: Number(els.blur.value),
      maxZoom: Number(els.maxZoom.value),
      maxIntensity: Number(els.maxIntensity.value),
      minOpacity: Number(els.minOpacity.value)
    };
    localStorage.setItem('heatmapSettings', JSON.stringify(settings));
  }

  // Load heatmap settings from localStorage
  function loadSettings() {
    try {
      const saved = localStorage.getItem('heatmapSettings');
      if (saved) {
        const settings = JSON.parse(saved);
        
        // Apply saved settings to controls
        if (settings.radius !== undefined) els.radius.value = settings.radius;
        if (settings.blur !== undefined) els.blur.value = settings.blur;
        if (settings.maxZoom !== undefined) els.maxZoom.value = settings.maxZoom;
        if (settings.maxIntensity !== undefined) els.maxIntensity.value = settings.maxIntensity;
        if (settings.minOpacity !== undefined) els.minOpacity.value = settings.minOpacity;
        
        // Update display labels
        applyInputsToLabels();
      }
    } catch (error) {
      console.warn('Failed to load heatmap settings:', error);
    }
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
            // Use individual count as weight if available, otherwise default to 1
            let weight = 1.0;
            if (result.gathering && result.gathering.interpretations && result.gathering.interpretations.individualCount) {
              const count = result.gathering.interpretations.individualCount;
              if (count && !isNaN(count)) {
                weight = parseFloat(count);
              }
            }
            
            points.push([lat, lon, weight]);
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

  function createOrUpdateHeat() {
    if (!currentPoints.length) return;

    const options = {
      radius: Number(els.radius.value),
      blur: Number(els.blur.value),
      maxZoom: Number(els.maxZoom.value),
      minOpacity: Number(els.minOpacity.value),
    };

    const maxIntensity = Number(els.maxIntensity.value);
    if (maxIntensity > 0) {
      options.max = maxIntensity;
    }

    if (heatLayer) {
      heatLayer.setOptions(options);
      heatLayer.setLatLngs(currentPoints);
    } else {
      heatLayer = L.heatLayer(currentPoints, options).addTo(map);
    }

    // Always fit to data when creating/updating heatmap
    const lats = currentPoints.map((p) => p[0]);
    const lngs = currentPoints.map((p) => p[1]);
    const bounds = L.latLngBounds(
      [Math.min(...lats), Math.min(...lngs)],
      [Math.max(...lats), Math.max(...lngs)]
    );
    if (bounds.isValid()) {
      map.fitBounds(bounds.pad(0.1));
    }
  }

  function applyInputsToLabels() {
    els.radiusVal.textContent = String(els.radius.value);
    els.blurVal.textContent = String(els.blur.value);
    els.minOpacityVal.textContent = String(els.minOpacity.value);
  }

  function autoApply() {
    applyInputsToLabels();
    saveSettings(); // Save settings whenever they change
    if (currentPoints.length) {
      createOrUpdateHeat();
    }
  }


  // Event listeners
  ["radius", "blur", "minOpacity", "maxZoom", "maxIntensity"].forEach((id) => {
    els[id].addEventListener("input", autoApply);
  });
  
  // Load saved settings and apply them
  loadSettings();

  // Load dataset and initialize heatmap
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

      setStatus(`Loaded ${currentPoints.length} points from dataset.`, 'ok');
      createOrUpdateHeat();

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
