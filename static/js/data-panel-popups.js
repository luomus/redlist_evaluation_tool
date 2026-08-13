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
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:10000;';
    
    const popup = document.createElement('div');
    popup.id = 'popupWindow';
    popup.style.cssText = 'background:white;border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,0.3);max-width:600px;width:90%;max-height:90vh;overflow-y:auto;position:relative;';
    
    const header = document.createElement('div');
    header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:16px;border-bottom:1px solid #eee;';
    
    const titleEl = document.createElement('h2');
    titleEl.textContent = title;
    titleEl.style.cssText = 'margin:0;font-size:18px;font-weight:600;';
    header.appendChild(titleEl);
    
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕';
    closeBtn.style.cssText = 'background:none;border:none;font-size:24px;cursor:pointer;color:#666;padding:0;width:32px;height:32px;display:flex;align-items:center;justify-content:center;';
    closeBtn.onclick = () => closePopup();
    header.appendChild(closeBtn);
    
    const body = document.createElement('div');
    body.style.cssText = 'padding:16px;';
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
        <div style="display:flex;flex-direction:column;gap:16px;">
            <div style="text-align:center;padding:32px;border:2px dashed #ccc;border-radius:8px;background:#fafafa;cursor:pointer;" id="dropZone" ondrop="handleCsvDrop(event)" ondragover="event.preventDefault();event.target.style.background='#f0f0f0'" ondragleave="event.target.style.background='#fafafa'">
                <div style="font-size:32px;margin-bottom:8px;">📤</div>
                <p style="margin:0 0 8px 0;font-weight:500;">Vedä ja pudota CSV-tiedosto tähän</p>
                <p style="margin:0;color:#666;font-size:12px;">tai klikkaa valitaksesi tiedoston</p>
                <input type="file" id="csvFileInput" accept=".csv" style="display:none;" onchange="handleCsvFileSelect(event)">
            </div>
            <div id="csvPreview" style="display:none;">
                <div style="padding:12px;background:#f0f8ff;border-radius:4px;margin-bottom:12px;">
                    <strong id="csvFileName"></strong><br>
                    <small id="csvFileSize" style="color:#666;"></small>
                </div>
                <button onclick="document.getElementById('csvFileInput').value=''; document.getElementById('csvPreview').style.display='none';" style="width:100%;padding:8px;background:#dc3545;color:white;border:none;border-radius:4px;cursor:pointer;font-size:12px;margin-bottom:12px;">Poista valinta</button>
                <button onclick="uploadCsvForMap()" style="width:100%;padding:8px;background:#28a745;color:white;border:none;border-radius:4px;cursor:pointer;font-size:13px;font-weight:500;">Lataa CSV</button>
            </div>
            <div id="csvProgress" style="display:none;">
                <p style="margin:0 0 8px 0;font-weight:500;">Edistyminen:</p>
                <div id="csvProgressLog" style="max-height:200px;overflow-y:auto;font-size:12px;border:1px solid #ddd;border-radius:4px;padding:8px;background:#fafafa;"></div>
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
        <div style="display:flex;flex-direction:column;gap:16px;">
            <div>
                <label style="font-size:12px;font-weight:500;display:block;margin-bottom:8px;">
                    Liitä Laji.fi URL-osoite
                    <span style="color:#666;font-size:11px;"> - Avaa laji.fi, rajaa havainnot ja kopioi URL</span>
                </label>
                <input type="text" id="lajifiUrlInput" placeholder="https://laji.fi/observation/list?..." style="width:100%;padding:8px;border:1px solid #ddd;border-radius:4px;font-size:12px;box-sizing:border-box;">
            </div>
            <button onclick="fetchDataForMap()" style="width:100%;padding:10px;background:#007bff;color:white;border:none;border-radius:4px;cursor:pointer;font-size:13px;font-weight:500;">Hae aineistoa</button>
            <div id="lajifiProgress" style="display:none;">
                <p style="margin:0 0 8px 0;font-weight:500;">Edistyminen:</p>
                <div id="lajifiProgressLog" style="max-height:300px;overflow-y:auto;font-size:12px;border:1px solid #ddd;border-radius:4px;padding:8px;background:#fafafa;"></div>
            </div>
            <div id="lajifiSaveSection" style="display:none;">
                <button onclick="saveDataForMap()" style="width:100%;padding:10px;background:#17a2b8;color:white;border:none;border-radius:4px;cursor:pointer;font-size:13px;font-weight:500;">Tallenna aineisto</button>
            </div>
        </div>
    `;
    createPopupWindow('Lataa laji.fi:stä', content);
}
