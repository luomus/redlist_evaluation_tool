/* global L */

(function () {
  const map = L.map("map").setView([60.1699, 24.9384], 11);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 22,
    attribution: "&copy; OpenStreetMap contributors",
  }).addTo(map);

  let gridLayerGroup = L.layerGroup().addTo(map);
  let currentRecords = []; // {lat, lon, name}
  let currentCells = []; // {bounds: [[south, west],[north, east]], count: number, center: [lat, lon]}

  const els = {
    file: document.getElementById("file"),
    uploadBtn: document.getElementById("uploadBtn"),
    applyBtn: document.getElementById("applyBtn"),
    status: document.getElementById("status"),
    maxZoom: document.getElementById("maxZoom"),
    minOpacity: document.getElementById("minOpacity"),
    minOpacityVal: document.getElementById("minOpacityVal"),
    gridSize: document.getElementById("gridSize"),
    colorScale: document.getElementById("colorScale"),
  };

  function setStatus(message, type) {
    els.status.textContent = message;
    els.status.className = "stats" + (type ? " " + type : "");
  }

  function renderGrid(fitToData = false) {
    gridLayerGroup.clearLayers();
    if (!currentCells.length) return;

    const opacity = Number(els.minOpacity.value);

    // Determine color scale from counts
    const counts = currentCells.map((c) => c.count);
    const minC = Math.min(...counts);
    const maxC = Math.max(...counts);

    function clamp01(x) { return Math.max(0, Math.min(1, x)); }
    function colorFor(value) {
      if (maxC === minC) {
        return "#2c7fb8"; // default base color
      }
      const t = clamp01((value - minC) / (maxC - minC));
      const sel = (els.colorScale && els.colorScale.value) || "blueRed";
      switch (sel) {
        case "blueOpacity": {
          // Always blue color, opacity varies with richness
          return "#0066cc"; // Fixed blue color
        }
        case "rainbow": {
          // HSV rainbow: h from 240 (blue) to 0 (red)
          const h = 240 * (1 - t);
          const s = 1, v = 1;
          return hsvToRgbCss(h, s, v);
        }
        case "viridis": {
          // Approx viridis-like via piecewise rgb interpolation
          return viridisLike(t);
        }
        case "magma": {
          return magmaLike(t);
        }
        case "blueRed":
        default: {
          // simple blue -> red gradient
          const r = Math.round(255 * t);
          const g = Math.round(64 * (1 - t));
          const b = Math.round(255 * (1 - t));
          return `rgb(${r},${g},${b})`;
        }
      }
    }

    function hsvToRgbCss(h, s, v) {
      const c = v * s;
      const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
      const m = v - c;
      let rp = 0, gp = 0, bp = 0;
      if (h < 60) { rp = c; gp = x; bp = 0; }
      else if (h < 120) { rp = x; gp = c; bp = 0; }
      else if (h < 180) { rp = 0; gp = c; bp = x; }
      else if (h < 240) { rp = 0; gp = x; bp = c; }
      else if (h < 300) { rp = x; gp = 0; bp = c; }
      else { rp = c; gp = 0; bp = x; }
      const r = Math.round((rp + m) * 255);
      const g = Math.round((gp + m) * 255);
      const b = Math.round((bp + m) * 255);
      return `rgb(${r},${g},${b})`;
    }

    function viridisLike(t) {
      // Key colors roughly from viridis: #440154 -> #21918c -> #fde725
      const stops = [
        [0.0, [68, 1, 84]],
        [0.5, [33, 145, 140]],
        [1.0, [253, 231, 37]],
      ];
      return gradientStops(stops, t);
    }

    function magmaLike(t) {
      // Rough magma-like: #000004 -> #b53679 -> #fbfbd0
      const stops = [
        [0.0, [0, 0, 4]],
        [0.5, [181, 54, 121]],
        [1.0, [251, 251, 208]],
      ];
      return gradientStops(stops, t);
    }

    function gradientStops(stops, t) {
      if (t <= stops[0][0]) return rgbArrToCss(stops[0][1]);
      if (t >= stops[stops.length - 1][0]) return rgbArrToCss(stops[stops.length - 1][1]);
      for (let i = 0; i < stops.length - 1; i++) {
        const [t0, c0] = stops[i];
        const [t1, c1] = stops[i + 1];
        if (t >= t0 && t <= t1) {
          const f = (t - t0) / (t1 - t0);
          const r = Math.round(c0[0] + (c1[0] - c0[0]) * f);
          const g = Math.round(c0[1] + (c1[1] - c0[1]) * f);
          const b = Math.round(c0[2] + (c1[2] - c0[2]) * f);
          return `rgb(${r},${g},${b})`;
        }
      }
      return rgbArrToCss(stops[0][1]);
    }

    function rgbArrToCss(arr) { return `rgb(${arr[0]},${arr[1]},${arr[2]})`; }

    const rects = [];
    for (const cell of currentCells) {
      const color = colorFor(cell.count);
      let fillOpacity = opacity;
      
      // For blue opacity mode, calculate opacity based on richness
      if (els.colorScale.value === "blueOpacity") {
        if (maxC === minC) {
          fillOpacity = opacity; // Use base opacity if all cells have same richness
        } else {
          // Opacity from 0 (no richness) to 1 (max richness) when fill opacity setting is 1
          const normalizedRichness = (cell.count - minC) / (maxC - minC);
          fillOpacity = normalizedRichness * opacity;
        }
      }
      
      const rect = L.rectangle(cell.bounds, {
        color: "#333",
        weight: 1,
        fillColor: color,
        fillOpacity: fillOpacity,
      }).bindTooltip(`Richness: ${cell.count}`, { sticky: true });
      rects.push(rect);
    }
    rects.forEach((r) => r.addTo(gridLayerGroup));

    if (fitToData) {
      const bounds = L.latLngBounds([]);
      currentCells.forEach((c) => bounds.extend(c.bounds));
      if (bounds.isValid()) {
        map.fitBounds(bounds.pad(0.1));
      }
    }
  }

  function applyInputsToLabels() {
    els.minOpacityVal.textContent = String(els.minOpacity.value);
  }

  function metersPerDegreeLat() {
    // Approximate meters per degree of latitude
    return 111320;
  }

  function metersPerDegreeLon(latDeg) {
    // Approximate meters per degree of longitude at given latitude
    return 111320 * Math.cos((latDeg * Math.PI) / 180);
  }

  function recomputeRichness() {
    const gridMeters = Math.max(50, Number(els.gridSize.value) || 250);
    if (!currentRecords.length) {
      currentCells = [];
      return;
    }

    // Use central latitude to estimate lon meter scale
    const avgLat =
      currentRecords.reduce((sum, r) => sum + r.lat, 0) / currentRecords.length;
    const mPerDegLat = metersPerDegreeLat();
    const mPerDegLon = metersPerDegreeLon(avgLat);

    // Convert grid size to degrees in both axes
    const dLat = gridMeters / mPerDegLat; // degrees of latitude per cell
    const dLon = gridMeters / mPerDegLon; // degrees of longitude per cell

    // Bucket records into grid cells keyed by i,j; track set of names per cell
    const cellKeyToSpecies = new Map();
    for (const r of currentRecords) {
      const i = Math.floor(r.lat / dLat);
      const j = Math.floor(r.lon / dLon);
      const key = `${i}:${j}`;
      let set = cellKeyToSpecies.get(key);
      if (!set) {
        set = new Set();
        cellKeyToSpecies.set(key, set);
      }
      set.add(r.name);
    }

    // Build cells with bounds and richness
    const cells = [];
    for (const [key, set] of cellKeyToSpecies.entries()) {
      const [iStr, jStr] = key.split(":");
      const i = Number(iStr);
      const j = Number(jStr);
      const south = i * dLat;
      const north = (i + 1) * dLat;
      const west = j * dLon;
      const east = (j + 1) * dLon;
      cells.push({
        bounds: [
          [south, west],
          [north, east],
        ],
        center: [(south + north) / 2, (west + east) / 2],
        count: set.size,
      });
    }

    currentCells = cells;
  }

  function autoApply() {
    applyInputsToLabels();
    if (currentRecords.length) {
      recomputeRichness();
      renderGrid(false);
    }
  }

  ["minOpacity", "maxZoom", "gridSize", "colorScale"].forEach(
    (id) => {
      if (els[id]) els[id].addEventListener("input", autoApply);
    }
  );
  applyInputsToLabels();

  els.uploadBtn.addEventListener("click", async () => {
    const file = els.file.files && els.file.files[0];
    if (!file) {
      setStatus("Choose a .tsv file first.", "error");
      return;
    }
    const form = new FormData();
    form.append("file", file, file.name);
    els.uploadBtn.disabled = true;
    setStatus("Uploading and parsing…");
    try {
      const res = await fetch("/api/upload_richness", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || res.statusText);

      currentRecords = data.records || [];
      recomputeRichness();
      setStatus(`Loaded ${data.count || currentRecords.length} records; computing grid…`, "ok");
      els.applyBtn.disabled = false;
      renderGrid(true);
    } catch (err) {
      console.error(err);
      setStatus(String(err), "error");
    } finally {
      els.uploadBtn.disabled = false;
    }
  });

  els.applyBtn.addEventListener("click", () => {
    recomputeRichness();
    renderGrid(false);
  });
})();


