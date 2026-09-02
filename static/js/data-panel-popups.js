// Data Panel Popup Management
// Handles modal popups for CSV uploads and Laji.fi data fetching

let popupRequestId = 0;

/**
 * Creates a modal popup window with a title, content, and close button
 * @param {string} title - The title of the popup
 * @param {string} content - The HTML content of the popup body
 * @returns {HTMLElement} The popup body element
 */
function createPopupWindow(title, content) {
    const overlay = document.createElement('div');
    overlay.id = 'popupOverlay';
    
    const popup = document.createElement('div');
    popup.id = 'popupWindow';
    
    const header = document.createElement('div');
    header.className = 'popup-header';
    
    const titleEl = document.createElement('h2');
    titleEl.className = 'popup-title';
    titleEl.textContent = title;
    header.appendChild(titleEl);
    
    const closeBtn = document.createElement('button');
    closeBtn.className = 'popup-close-btn';
    closeBtn.textContent = '✕';
    closeBtn.onclick = () => closePopup();
    header.appendChild(closeBtn);
    
    const body = document.createElement('div');
    body.className = 'popup-body';
    body.innerHTML = content;
    
    popup.appendChild(header);
    popup.appendChild(body);
    overlay.appendChild(popup);
    document.body.appendChild(overlay);
    
    overlay.onclick = (e) => {
        if (e.target === overlay) closePopup();
    };
    
    return body;
}

/**
 * Closes the current popup window
 */
function closePopup() {
    popupRequestId++;
    const overlay = document.getElementById('popupOverlay');
    if (overlay) overlay.remove();
}

function setDatasetTableState(body, message, className) {
    const state = document.createElement('div');
    state.className = `dataset-table-state ${className}`;
    state.textContent = message;
    body.replaceChildren(state);
}

function formatDatasetTableValue(value) {
    if (value === null || typeof value === 'undefined') return '';

    let formatted = value;
    if (typeof value === 'object') {
        try {
            formatted = JSON.stringify(value);
        } catch (error) {
            formatted = String(value);
        }
    }

    const text = String(formatted);
    return text.length > 500 ? `${text.slice(0, 500)}...` : text;
}

function renderDatasetTable(body, datasetName, features) {
    if (features.length === 0) {
        setDatasetTableState(body, 'Aineistossa ei ole havaintoja.', 'dataset-table-empty');
        return;
    }

    const internalKeys = new Set(['_db_id', '_dataset_id', '_has_modified_geometry', 'excluded']);
    const columns = new Set();
    features.forEach(feature => {
        Object.keys(feature.properties || {}).forEach(key => {
            if (!internalKeys.has(key)) columns.add(key);
        });
    });

    const propertyColumns = Array.from(columns).sort((left, right) => left.localeCompare(right, 'fi'));
    const wrapper = document.createElement('div');
    wrapper.className = 'dataset-table-container';
    const table = document.createElement('table');
    table.className = 'dataset-table';
    const head = document.createElement('thead');
    const headerRow = document.createElement('tr');
    ['ID', 'Geometria', 'Pois käytöstä', ...propertyColumns].forEach(column => {
        const th = document.createElement('th');
        th.textContent = column;
        headerRow.appendChild(th);
    });
    head.appendChild(headerRow);
    table.appendChild(head);

    const tableBody = document.createElement('tbody');
    features.forEach(feature => {
        const properties = feature.properties || {};
        const row = document.createElement('tr');
        const values = [
            properties._db_id,
            feature.geometry ? feature.geometry.type : '',
            properties.excluded ? 'Kyllä' : 'Ei',
            ...propertyColumns.map(column => properties[column])
        ];
        values.forEach(value => {
            const cell = document.createElement('td');
            cell.textContent = formatDatasetTableValue(value);
            row.appendChild(cell);
        });
        tableBody.appendChild(row);
    });
    table.appendChild(tableBody);
    wrapper.appendChild(table);
    body.replaceChildren(wrapper);

    const title = body.parentElement.querySelector('.popup-title');
    if (title) title.textContent = `${datasetName} (${features.length})`;
}

window.openDatasetTable = async function(datasetId, datasetName) {
    closePopup();
    const body = createPopupWindow(datasetName, '');
    body.parentElement.classList.add('dataset-table-popup');
    const requestId = ++popupRequestId;
    setDatasetTableState(body, 'Ladataan havaintoja...', 'dataset-table-loading');

    try {
        const features = [];
        let page = 1;
        let totalPages = 1;

        do {
            const params = new URLSearchParams({
                dataset_id: datasetId,
                page: String(page),
                per_page: '1000'
            });
            const response = await fetch(`/api/observations/${encodeURIComponent(window.MX_ID)}?${params}`);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            const data = await response.json();
            if (requestId !== popupRequestId || !body.isConnected) return;

            features.push(...(data.features || []));
            totalPages = Math.max(1, (data.pagination && data.pagination.pages) || 1);
            page++;
            if (page <= totalPages) {
                setDatasetTableState(body, `Ladataan havaintoja (${page} / ${totalPages})...`, 'dataset-table-loading');
            }
        } while (page <= totalPages);

        if (requestId === popupRequestId && body.isConnected) {
            renderDatasetTable(body, datasetName, features);
        }
    } catch (error) {
        if (requestId === popupRequestId && body.isConnected) {
            setDatasetTableState(body, `Aineiston lataaminen epäonnistui: ${error.message}`, 'dataset-table-error');
        }
    }
};

/**
 * Opens the CSV upload popup with drag-and-drop support
 */
function openCsvUploadPopup() {
    const content = `
        <div class="csv-container">
            <div class="csv-drop-zone" id="dropZone" ondrop="handleCsvDrop(event)" ondragover="event.preventDefault();event.target.classList.add('csv-drop-zone--hover')" ondragleave="event.target.classList.remove('csv-drop-zone--hover')">
                <div class="csv-drop-zone-icon">📤</div>
                <p class="csv-drop-zone-text-main">Vedä ja pudota CSV-tiedosto tähän</p>
                <p class="csv-drop-zone-text-sub">tai klikkaa valitaksesi tiedoston</p>
                <input type="file" id="csvFileInput" accept=".csv" onchange="handleCsvFileSelect(event)">
            </div>
            <div id="csvPreview">
                <div class="csv-preview-info">
                    <strong id="csvFileName"></strong><br>
                    <small id="csvFileSize"></small>
                </div>
                <button onclick="document.getElementById('csvFileInput').value=''; document.getElementById('csvPreview').style.display='none';" class="btn-csv-remove">Poista valinta</button>
                <button onclick="uploadCsvForMap()" class="btn-csv-upload-action">Lataa CSV</button>
            </div>
            <div id="csvProgress">
                <p class="csv-progress-label">Edistyminen:</p>
                <div id="csvProgressLog"></div>
            </div>
        </div>
    `;
    createPopupWindow('Lataa CSV koneelta', content);
    document.getElementById('dropZone').onclick = () => document.getElementById('csvFileInput').click();
}

/**
 * Handles drag-and-drop for CSV files
 */
function handleCsvDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    const files = e.dataTransfer.files;
    if (files.length > 0) {
        document.getElementById('csvFileInput').files = files;
        handleCsvFileSelect({ target: { files } });
    }
}

/**
 * Handles CSV file selection and displays file preview
 */
function handleCsvFileSelect(e) {
    const file = e.target.files[0];
    if (file) {
        document.getElementById('csvFileName').textContent = file.name;
        document.getElementById('csvFileSize').textContent = (file.size / 1024).toFixed(2) + ' KB';
        document.getElementById('csvPreview').style.display = 'block';
    }
}

/**
 * Opens the Laji.fi fetch popup for URL-based data import
 */
function openLajifiPopup(mxCode) {
    const defaultUrl = mxCode ? `https://laji.fi/observation/list?target=${mxCode}` : '';
    const content = `
        <div class="lajifi-container">
            <div class="lajifi-label-group">
                <label class="lajifi-label">
                    Liitä Laji.fi URL-osoite
                    <span class="lajifi-label-hint"> - Avaa laji.fi, rajaa havainnot ja kopioi URL</span>
                </label>
                <input type="text" id="lajifiUrlInput" placeholder="https://laji.fi/observation/list?..." class="lajifi-input" value="${defaultUrl}">
            </div>
            <div class="lajifi-label-group">
                <label class="lajifi-label">
                    Koordinaattien maksimitarkkuus
                    <span class="lajifi-label-hint"> - Jätä tyhjäksi, jos et halua suodattaa</span>
                </label>
                <input type="number" id="lajifiAccuracyMaxInput" placeholder="esim. 10000" class="lajifi-input" min="0" step="100">
            </div>
            <button onclick="fetchDataForMap()" class="btn-lajifi-fetch">Hae aineistoa</button>
            <div id="lajifiProgress">
                <p class="lajifi-progress-label">Edistyminen:</p>
                <div id="lajifiProgressLog"></div>
            </div>
            <div id="lajifiSaveSection">
                <button onclick="saveDataForMap()" class="btn-lajifi-save">Tallenna aineisto</button>
            </div>
        </div>
    `;
    createPopupWindow('Lataa laji.fi:stä', content);
}
