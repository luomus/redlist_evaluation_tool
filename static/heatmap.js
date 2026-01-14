/* global L */

(function () {
  const map = L.map("map").setView([60.1699, 24.9384], 11);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 22,
    attribution: "&copy; OpenStreetMap contributors",
  }).addTo(map);

  let heatLayer = null;
  let currentPoints = [];

  const els = {
    file: document.getElementById("file"),
    uploadBtn: document.getElementById("uploadBtn"),
    applyBtn: document.getElementById("applyBtn"),
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

  function setStatus(message, type) {
    els.status.textContent = message;
    els.status.className = "stats" + (type ? " " + type : "");
  }

  function createOrUpdateHeat(fitToData = false) {
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

    if (fitToData) {
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
  }

  function applyInputsToLabels() {
    els.radiusVal.textContent = String(els.radius.value);
    els.blurVal.textContent = String(els.blur.value);
    els.minOpacityVal.textContent = String(els.minOpacity.value);
  }

  function autoApply() {
    applyInputsToLabels();
    if (currentPoints.length) {
      createOrUpdateHeat(false);
    }
  }

  ["radius", "blur", "minOpacity", "maxZoom", "maxIntensity"].forEach((id) => {
    els[id].addEventListener("input", autoApply);
  });
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
      const res = await fetch("/api/upload", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || res.statusText);

      currentPoints = data.points || [];
      setStatus(`Loaded ${data.count || currentPoints.length} points.`, "ok");
      els.applyBtn.disabled = false;
      createOrUpdateHeat(true);
    } catch (err) {
      console.error(err);
      setStatus(String(err), "error");
    } finally {
      els.uploadBtn.disabled = false;
    }
  });

  els.applyBtn.addEventListener("click", () => {
    createOrUpdateHeat(false);
  });
})();
