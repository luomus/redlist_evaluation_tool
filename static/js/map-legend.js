/* global L */

// ─────────────────────────────────────────────────────────────────────────
// Legend control UI and dataset state management
// Depends on: map-utils.js, map-dialogs.js
// ─────────────────────────────────────────────────────────────────────────

/**
 * Helper: sanitize DOM id for dataset entry
 */
function sanitizeDomId(s) {
    return 'ds-' + String(s || '').replace(/[^a-z0-9_-]/ig, '_');
}

/**
 * Ensure dataset layer exists and return it
 */
function ensureDatasetLayer(dsId, dsName) {
    window.datasetLayers = window.datasetLayers || {};
    if (!window.datasetLayers[dsId]) {
        const g = L.layerGroup().addTo(window.sharedMap);
        window.datasetLayers[dsId] = { group: g, name: dsName || dsId, count: 0 };
    }
    return window.datasetLayers[dsId];
}

/**
 * Add a created Leaflet layer to the dataset group and update counts/UI
 */
function addToDataset(layer, properties) {
    try {
        const dsId = (properties && (properties._dataset_id || properties.dataset_id)) || 'unknown';
        const dsName = (properties && (properties.dataset_name || properties.dataset_name)) || dsId;
        const dsEntry = ensureDatasetLayer(dsId, dsName);
        dsEntry.group.addLayer(layer);
        dsEntry.count = (dsEntry.count || 0) + 1;
        const countEl = document.getElementById('legend-count-' + sanitizeDomId(dsId));
        if (countEl) countEl.textContent = dsEntry.count;
    } catch (e) {
        console.warn('addToDataset error', e);
    }
}

/**
 * Update legend checkbox state based on actual feature exclusion state
 * A dataset checkbox should be checked (enabled) only if at least one feature is included
 */
window.syncLegendWithFeatures = function() {
    if (!window.datasetLayers) return;
    
    for (const dsId in window.datasetLayers) {
        const entry = window.datasetLayers[dsId];
        if (!entry || !entry.group) continue;
        
        let hasIncludedFeatures = false;
        let totalFeatures = 0;
        let includedFeatures = 0;
        
        // Check all layers in this dataset
        try {
            entry.group.eachLayer(function(layer) {
                totalFeatures++;
                const props = (layer.feature && layer.feature.properties) || layer.feature || {};
                const excluded = props.excluded === true || props.excluded === '1' || props.excluded === 1;
                if (!excluded) {
                    hasIncludedFeatures = true;
                    includedFeatures++;
                }
            });
        } catch (e) {
            console.warn('Error checking layers for dataset', dsId, e);
        }
        
        // Update the legend checkbox without triggering change event
        const safe = sanitizeDomId(dsId);
        const checkbox = document.getElementById('legend-cb-' + safe);
        if (checkbox && totalFeatures > 0) {
            const shouldBeChecked = hasIncludedFeatures;
            if (checkbox.checked !== shouldBeChecked) {
                // Temporarily disable to prevent change event
                const changeHandler = checkbox.onchange;
                checkbox.onchange = null;
                checkbox.checked = shouldBeChecked;
                checkbox.onchange = changeHandler;
            }
        }
        
        // Update the count display to show included/total
        const countEl = document.getElementById('legend-count-' + safe);
        if (countEl) {
            countEl.textContent = `${includedFeatures}/${totalFeatures}`;
        }
    }
};

/**
 * Toggle exclude for all observations in a dataset (by dataset id)
 */
window.toggleDatasetExclude = async function(dsid, exclude) {
    if (!dsid) throw new Error('No dataset id');
    window._datasetTogglePending = window._datasetTogglePending || {};
    if (window._datasetTogglePending[dsid]) throw new Error('Operation already in progress');
    const entry = window.datasetLayers && window.datasetLayers[dsid];
    if (!entry) throw new Error('Dataset not found');

    // Gather DB ids from dataset group's layers
    const ids = [];
    try {
        entry.group.eachLayer(function(layer) {
            const props = (layer.feature && layer.feature.properties) || layer.feature || {};
            const id = props && (props._db_id || props.db_id);
            if (id) ids.push(id);
        });
    } catch (e) {
        console.error('Error gathering IDs for dataset', dsid, e);
    }

    if (!ids.length) throw new Error('No DB-backed features in dataset');

    window._datasetTogglePending[dsid] = true;
    try {
        const res = await window.setExcludeBatch(ids, exclude);
        // After batch operation, legend sync is already called by setExcludeBatch
        // But also explicitly update this specific checkbox to ensure it reflects the operation
        const safe = sanitizeDomId(dsid);
        const checkbox = document.getElementById('legend-cb-' + safe);
        if (checkbox) {
            // If we excluded all, checkbox should be unchecked; if we included all, it should be checked
            const shouldBeChecked = !exclude;
            if (checkbox.checked !== shouldBeChecked) {
                const changeHandler = checkbox.onchange;
                checkbox.onchange = null;
                checkbox.checked = shouldBeChecked;
                checkbox.onchange = changeHandler;
            }
        }
        return res;
    } finally {
        window._datasetTogglePending[dsid] = false;
    }
};

/**
 * Create a Leaflet control that lists datasets with checkboxes to toggle them
 */
window.createLegendControl = function() {
    const control = L.control({ position: 'topright' });
    control.onAdd = function() {
        const div = L.DomUtil.create('div', 'leaflet-bar legend-control');
        div.innerHTML = `
            <div class="legend-header"><strong>Karttavalinnat</strong></div>
            <div class="basemap-section">
                <div class="basemap-label">Taustakartta:</div>
                <div id="basemap-selector" class="basemap-selector"></div>
            </div>
            <div class="legend-divider"></div>
            <div class="legend-item">
                <label><input type="checkbox" id="bioregions-toggle"> Eliömaakunnat</label>
            </div>
            <div class="legend-item">
                <label><input type="checkbox" id="threatened-zones-toggle"> Uhanalaisuusarviointialueet</label>
            </div>
            <div class="legend-divider"></div>
            <div class="legend-header"><strong>Aineistot:</strong></div>
            <div id="dataset-legend-list" class="legend-list">Ladataan…</div>
            <div class="legend-divider"></div>
            <div class="legend-header"><strong>Koordinaattien tarkkuus</strong></div>
            <div class="legend-accuracy">
                <div><span class="legend-swatch accuracy-1-10"></span>1-10 m</div>
                <div><span class="legend-swatch accuracy-11-100"></span>11-100 m</div>
                <div><span class="legend-swatch accuracy-101-1000"></span>101-1000 m</div>
                <div><span class="legend-swatch accuracy-1001-10000"></span>1001-10000 m</div>
                <div><span class="legend-swatch accuracy-10001-100000"></span>10001-100000 m</div>
                <div><span class="legend-swatch no-accuracy"></span>Ei arvoa *</div>
            </div>
            <div class="legend-note">
                (*) jos havaintoa ei ole tarkkuusarvoa, se näkyy kartalla oletusvärillä (punainen/harmaa).<br>
                punainen = analyysiin sisällytetty, harmaa = poistettu.
            </div>
        `;
        L.DomEvent.disableClickPropagation(div);
        return div;
    };
    control.addTo(window.sharedMap);

    // Populate basemap selector
    const basemapSelector = document.getElementById('basemap-selector');
    for (const [key, basemap] of Object.entries(window.basemaps)) {
        const btn = document.createElement('button');
        btn.className = 'basemap-btn' + (key === 'osm' ? ' active' : '');
        btn.setAttribute('data-basemap-id', key);
        btn.textContent = basemap.name;
        btn.addEventListener('click', () => window.switchBasemap(key));
        basemapSelector.appendChild(btn);
    }

    // Setup biogeographical regions toggle
    const bioregionsToggle = document.getElementById('bioregions-toggle');
    if (bioregionsToggle) {
        bioregionsToggle.addEventListener('change', function() {
            if (this.checked) {
                if (window.bioRegionsLayer && window.sharedMap) {
                    window.bioRegionsLayer.addTo(window.sharedMap);
                    window.bioRegionsVisible = true;
                }
            } else {
                if (window.bioRegionsLayer && window.sharedMap) {
                    window.sharedMap.removeLayer(window.bioRegionsLayer);
                    window.bioRegionsVisible = false;
                }
            }
        });
    }

    // Setup threatened species evaluation zones toggle
    const threatenedZonesToggle = document.getElementById('threatened-zones-toggle');
    if (threatenedZonesToggle) {
        threatenedZonesToggle.addEventListener('change', function() {
            if (this.checked) {
                if (window.threatenedZonesLayer && window.sharedMap) {
                    window.threatenedZonesLayer.addTo(window.sharedMap);
                    window.threatenedZonesVisible = true;
                }
            } else {
                if (window.threatenedZonesLayer && window.sharedMap) {
                    window.sharedMap.removeLayer(window.threatenedZonesLayer);
                    window.threatenedZonesVisible = false;
                }
            }
        });
    }

    // Helper function to add a dataset item to the legend
    function addDatasetItemToLegend(list, dsId, dsName, dsCount) {
        const safe = sanitizeDomId(dsId);
        window.datasetLayers = window.datasetLayers || {};
        if (!window.datasetLayers[dsId]) {
            window.datasetLayers[dsId] = { group: L.layerGroup().addTo(window.sharedMap), name: dsName, count: dsCount || 0 };
        } else {
            window.datasetLayers[dsId].name = dsName;
        }
        
        const item = document.createElement('div');
        item.className = 'legend-item';
        
        const label = document.createElement('label');
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.id = `legend-cb-${safe}`;
        checkbox.checked = true;
        checkbox.setAttribute('data-dsid', dsId);
        label.appendChild(checkbox);
        label.appendChild(document.createTextNode(`${dsName} `));

        const count = document.createElement('span');
        count.className = 'legend-count';
        count.id = `legend-count-${safe}`;
        count.textContent = window.datasetLayers[dsId].count || 0;
        label.appendChild(count);

        const tableBtn = document.createElement('button');
        tableBtn.className = 'legend-table-btn';
        tableBtn.type = 'button';
        tableBtn.textContent = '▦';
        tableBtn.title = 'Näytä taulukkona';
        tableBtn.setAttribute('aria-label', `Näytä aineisto ${dsName} taulukkona`);
        tableBtn.onclick = function(e) {
            e.stopPropagation();
            if (window.openDatasetTable) {
                window.openDatasetTable(dsId, dsName);
            }
        };
        
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'legend-delete-btn';
        deleteBtn.textContent = '✕';
        deleteBtn.onclick = async function(e) {
            e.stopPropagation();
            if (window.deleteMapDataset) {
                await window.deleteMapDataset(dsId);
            }
        };
        
        item.appendChild(label);
        item.appendChild(tableBtn);
        item.appendChild(deleteBtn);
        list.appendChild(item);
        
        document.getElementById('legend-cb-' + safe).addEventListener('change', async function () {
            const dsid = this.getAttribute('data-dsid');
            const entry = window.datasetLayers[dsid];
            if (!entry) return;
            const checked = this.checked;
            const exclude = !checked;

            // Compute how many features would actually be affected by this operation
            let affectedCount = 0;
            try {
                if (entry.group && typeof entry.group.eachLayer === 'function') {
                    entry.group.eachLayer(function(layer) {
                        const props = (layer.feature && layer.feature.properties) || layer.feature || {};
                        const id = props && (props._db_id || props.db_id);
                        if (!id) return;
                        const isExcluded = props.excluded === true || props.excluded === '1' || props.excluded === 1;
                        if ((exclude && !isExcluded) || (!exclude && isExcluded)) affectedCount++;
                    });
                }
            } catch (e) { console.warn('Error counting affected features for dataset', dsid, e); }

            // Fallback to total count if none found in the group
            if (affectedCount === 0) {
                affectedCount = entry.count || 0;
            }

            if (affectedCount === 0) {
                window.mapDialogs.notify(`Tässä aineistossa ei ole havaintoja, joita voisi ${exclude ? 'poistaa käytöstä' : 'ottaa käyttöön'}.`);
                this.checked = !checked;
                return;
            }

            this.disabled = true;
            try {
                await window.toggleDatasetExclude(dsid, exclude);
            } catch (err) {
                console.error('Error toggling dataset exclude:', err);
                window.mapDialogs.notify('Virhe muutettaessa aineistoa: ' + (err && err.message || err));
                this.checked = !checked;
            } finally {
                this.disabled = false;
            }
        });
    }

    // Populate the legend from server dataset list
    const mxId = window.MX_ID || null;
    const datasetsUrl = mxId ? `/api/taxons/${encodeURIComponent(mxId)}/datasets` : null;
    
    // Function to load and populate datasets in legend
    window.refreshDatasetLegend = async function() {
        if (!datasetsUrl) return;
        try {
            const r = await fetch(datasetsUrl);
            const data = await r.json();
            const list = document.getElementById('dataset-legend-list');
            if (!list) return;
            list.innerHTML = '';
            const datasets = (data && data.datasets) || [];
            
            if (datasets.length === 0) {
                list.innerHTML = '<div style="color:#999; font-size:12px; padding: 8px;">Ei aineistoja</div>';
                return;
            }
            
            datasets.forEach(ds => {
                const dsId = ds.dataset_id || ds.id || ds.name;
                const dsName = ds.dataset_name || ds.name || dsId;
                addDatasetItemToLegend(list, dsId, dsName, ds.count || 0);
            });

            // Also list any existing datasetLayers not returned by server
            for (const kd in window.datasetLayers) {
                if (!datasets.find(d => String(d.dataset_id || d.id || d.name) === String(kd))) {
                    const dsName = window.datasetLayers[kd].name || kd;
                    addDatasetItemToLegend(list, kd, dsName, window.datasetLayers[kd].count || 0);
                }
            }
            
            if (typeof window.syncLegendWithFeatures === 'function') {
                setTimeout(() => {
                    try { window.syncLegendWithFeatures(); } catch (e) { console.warn('Legend sync failed:', e); }
                }, 100);
            }
        } catch (err) {
            const list = document.getElementById('dataset-legend-list');
            if (list) list.textContent = 'Aineistojen lataus epäonnistui';
            console.warn('Failed to load datasets for legend', err);
        }
    };

    // Initial load of datasets
    if (!datasetsUrl) {
        const list = document.getElementById('dataset-legend-list');
        if (list) list.textContent = 'Taksonin tunniste puuttuu';
    } else {
        window.refreshDatasetLegend();
    }

    return control;
};
