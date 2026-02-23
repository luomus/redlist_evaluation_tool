/**
 * simple.js – Main page controller.
 *
 * Initializes the hierarchy browser and handles species data management,
 * user info, and data fetching / CSV upload for individual species.
 * Data panels are rendered inline inside species cards by hierarchy.js.
 */

// ---- Init ----
document.addEventListener('DOMContentLoaded', function () {
    loadUserInfo();
    loadHierarchy();  // from hierarchy.js
});

// ---- User info ----
async function loadUserInfo() {
    try {
        const resp = await fetch('/api/user');
        if (resp.ok) {
            const data = await resp.json();
            const el = document.getElementById('userInfo');
            if (el) {
                let html = '';
                if (data.user_name) html += `<strong>${data.user_name}</strong>`;
                if (data.user_email) html += `<br><small>${data.user_email}</small>`;
                if (data.user_id) html += `<br><small>ID: ${data.user_id}</small>`;
                el.innerHTML = html || '';
            }
        }
    } catch (e) {
        console.error('Failed to load user info:', e);
    }
}

// ---- Success / error messages ----
function showSuccess(message) {
    const el = document.getElementById('error');
    el.textContent = message;
    el.style.color = '#155724';
    el.style.backgroundColor = '#d4edda';
    el.style.border = '1px solid #c3e6cb';
    el.style.display = 'block';
    setTimeout(() => { el.style.display = 'none'; }, 3000);
}

function showError(message) {
    const el = document.getElementById('error');
    el.textContent = message;
    el.style.color = '#721c24';
    el.style.backgroundColor = '#f8d7da';
    el.style.border = '1px solid #f5c6cb';
    el.style.display = 'block';
}

// ---- Species datasets (inline panels) ----

async function loadSpeciesDatasets(speciesId) {
    const container = document.getElementById(`datasets-${speciesId}`);
    if (!container) return;
    try {
        const resp = await fetch(`/api/species/${speciesId}/datasets`);
        const data = await resp.json();
        displayDatasets(speciesId, data.datasets || [], container);
    } catch (err) {
        console.error('Error loading datasets:', err);
        container.innerHTML = '<p>Aineistojen lataus epäonnistui</p>';
    }
}

function displayDatasets(speciesId, datasets, container) {
    if (datasets.length === 0) {
        container.innerHTML = '<p style="color:#999;">Ei vielä aineistoja. Hae tai lataa data alla.</p>';
        return;
    }
    let html = '<div class="dataset-list">';
    for (const ds of datasets) {
        html += `
        <div class="dataset-item">
            <div class="dataset-info">
                <div><strong>Nimi:</strong> ${escapeHtml(ds.dataset_name || 'Nimetön')}</div>
                <div><strong>Havainnot:</strong> ${ds.count}</div>
                <div><strong>Lisätty:</strong> ${new Date(ds.created_at).toLocaleString()}</div>
                ${ds.dataset_url ? `<div><strong>Lähde:</strong> <a href="${escapeHtml(ds.dataset_url)}" target="_blank" style="word-break:break-all;">${escapeHtml(ds.dataset_url)}</a></div>` : ''}
            </div>
            <div class="dataset-actions">
                <button onclick="downloadDataset(${speciesId}, '${ds.dataset_id}')" class="btn-small btn-primary">Lataa</button>
                ${ds.dataset_url ? `<button onclick="reloadDatasetEncoded(${speciesId}, '${ds.dataset_id}', '${encodeURIComponent(ds.dataset_url)}')" class="btn-small btn-primary">Päivitä</button>` : ''}
                <button onclick="deleteDataset(${speciesId}, '${ds.dataset_id}')" class="btn-small btn-danger">Poista</button>
            </div>
        </div>`;
    }
    html += '</div>';
    container.innerHTML = html;
}

// ---- Fetch data from laji.fi ----

async function fetchDataForSpecies(speciesId) {
    const urlInput = document.getElementById(`url-${speciesId}`);
    const url = urlInput ? urlInput.value.trim() : '';
    if (!url) { showError('Syötä URL-osoite'); return; }

    const progressDiv = document.getElementById(`fetch-progress-${speciesId}`);
    const progressLog = document.getElementById(`progress-log-${speciesId}`);
    if (progressDiv) progressDiv.style.display = 'block';
    if (progressLog) progressLog.innerHTML = '';

    try {
        await window.parseUrl(url, progressLog);
        const saveSection = document.getElementById(`save-section-${speciesId}`);
        if (saveSection) saveSection.style.display = 'block';
        // Store which species this fetch belongs to
        window._fetchTargetSpeciesId = speciesId;
    } catch (err) {
        showError('Haun suoritus epäonnistui: ' + err.message);
    }
}

function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

async function saveDataForSpecies(speciesId) {
    if (!window.currentFetchedData) {
        showError('Ei tallennettavaa dataa. Hae data ensin.');
        return;
    }
    const datasetNameInput = document.getElementById(`dataset-name-${speciesId}`);
    const datasetName = datasetNameInput ? datasetNameInput.value.trim() : '';
    const currentApiUrl = window.currentFetchedUrl || '';

    try {
        const resp = await fetch('/api/observations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                project_id: speciesId,
                dataset_id: generateId(),
                dataset_name: datasetName || `Dataset ${new Date().toLocaleString()}`,
                dataset_url: currentApiUrl,
                features: window.currentFetchedData.features
            })
        });
        const result = await resp.json();
        if (result.success) {
            showSuccess(`Aineisto tallennettu! ${result.count} havaintoa.`);
            const urlInput = document.getElementById(`url-${speciesId}`);
            if (urlInput) urlInput.value = '';
            if (datasetNameInput) datasetNameInput.value = '';
            const saveSection = document.getElementById(`save-section-${speciesId}`);
            if (saveSection) saveSection.style.display = 'none';
            const progressDiv = document.getElementById(`fetch-progress-${speciesId}`);
            if (progressDiv) progressDiv.style.display = 'none';
            window.currentFetchedData = null;
            window.currentFetchedUrl = null;
            await loadSpeciesDatasets(speciesId);
        } else {
            showError('Tallennus epäonnistui: ' + result.error);
        }
    } catch (err) {
        console.error('Error saving data:', err);
        showError('Tallennus epäonnistui');
    }
}

// ---- CSV upload ----

async function uploadCsvForSpecies(speciesId) {
    const fileInput = document.getElementById(`file-${speciesId}`);
    if (!fileInput || !fileInput.files.length) {
        showError('Valitse CSV-tiedosto');
        return;
    }
    const datasetNameInput = document.getElementById(`dataset-name-${speciesId}`);
    const datasetName = datasetNameInput ? datasetNameInput.value.trim() : '';
    const form = new FormData();
    form.append('file', fileInput.files[0]);
    if (datasetName) form.append('dataset_name', datasetName);

    try {
        const resp = await fetch(`/api/species/${speciesId}/upload_csv`, {
            method: 'POST',
            body: form
        });
        const result = await resp.json();
        if (result.success) {
            showSuccess(`Ladattu ${result.count} havaintoa`);
            fileInput.value = '';
            await loadSpeciesDatasets(speciesId);
        } else {
            showError('Lataus epäonnistui: ' + result.error);
        }
    } catch (err) {
        console.error('Upload error:', err);
        showError('Lähetys epäonnistui');
    }
}

// ---- Download / reload / delete dataset ----

async function downloadDataset(speciesId, datasetId) {
    try {
        const resp = await fetch(`/api/species/${speciesId}/download_csv?dataset_id=${encodeURIComponent(datasetId)}`);
        if (!resp.ok) {
            const err = await resp.json();
            showError('Lataus epäonnistui: ' + (err.error || resp.statusText));
            return;
        }
        const blob = await resp.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `dataset_${datasetId}.csv`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
        showSuccess('Aineisto ladattu');
    } catch (err) {
        console.error('Download error:', err);
        showError('Lataus epäonnistui');
    }
}

function reloadDatasetEncoded(speciesId, datasetId, encodedUrl) {
    try {
        const url = decodeURIComponent(encodedUrl || '');
        reloadDataset(speciesId, datasetId, url);
    } catch (e) {
        showError('Virheellinen URL');
    }
}

async function reloadDataset(speciesId, datasetId, url) {
    if (!url) { showError('Ei lähde-URL-osoitetta'); return; }
    if (!confirm('Uudelleenlataus korvaa olemassa olevan aineiston. Jatketaanko?')) return;

    const progressDiv = document.getElementById(`fetch-progress-${speciesId}`);
    const progressLog = document.getElementById(`progress-log-${speciesId}`);
    if (progressDiv && progressLog) {
        progressDiv.style.display = 'block';
        progressLog.innerHTML = '';
    }

    try {
        await window.parseUrl(url, progressLog);

        // Get existing dataset name
        let dsName = `Dataset ${new Date().toLocaleString()}`;
        try {
            const dsResp = await fetch(`/api/species/${speciesId}/datasets`);
            const dsData = await dsResp.json();
            const ds = (dsData.datasets || []).find(d => d.dataset_id === datasetId);
            if (ds && ds.dataset_name) dsName = ds.dataset_name;
        } catch (e) {}

        // Delete old, save new
        await fetch(`/api/species/${speciesId}/datasets/${encodeURIComponent(datasetId)}`, { method: 'DELETE' });
        const resp = await fetch('/api/observations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                project_id: speciesId,
                dataset_id: datasetId,
                dataset_name: dsName,
                dataset_url: url,
                features: window.currentFetchedData ? window.currentFetchedData.features : []
            })
        });
        const result = await resp.json();
        if (result.success) {
            showSuccess('Aineisto päivitetty!');
            await loadSpeciesDatasets(speciesId);
            if (progressDiv) progressDiv.style.display = 'none';
            window.currentFetchedData = null;
            window.currentFetchedUrl = null;
        } else {
            showError('Tallennus epäonnistui: ' + result.error);
        }
    } catch (err) {
        console.error('Reload error:', err);
        showError('Uudelleenlataus epäonnistui');
    }
}

async function deleteDataset(speciesId, datasetId) {
    if (!confirm('Haluatko varmasti poistaa tämän aineiston?')) return;
    try {
        const resp = await fetch(`/api/species/${speciesId}/datasets/${encodeURIComponent(datasetId)}`, { method: 'DELETE' });
        const result = await resp.json();
        if (result.success) {
            showSuccess('Aineisto poistettu!');
            await loadSpeciesDatasets(speciesId);
        } else {
            showError('Poistaminen epäonnistui: ' + result.error);
        }
    } catch (err) {
        console.error('Delete error:', err);
        showError('Poistaminen epäonnistui');
    }
}

