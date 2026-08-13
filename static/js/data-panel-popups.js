// Data Panel Popup Management
// Handles modal popups for CSV uploads and Laji.fi data fetching

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
    const overlay = document.getElementById('popupOverlay');
    if (overlay) overlay.remove();
}

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
function openLajifiPopup() {
    const content = `
        <div class="lajifi-container">
            <div class="lajifi-label-group">
                <label class="lajifi-label">
                    Liitä Laji.fi URL-osoite
                    <span class="lajifi-label-hint"> - Avaa laji.fi, rajaa havainnot ja kopioi URL</span>
                </label>
                <input type="text" id="lajifiUrlInput" placeholder="https://laji.fi/observation/list?..." class="lajifi-input">
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
