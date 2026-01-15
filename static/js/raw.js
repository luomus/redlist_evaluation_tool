// IndexedDB setup
let db;
let currentDataset = null;

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

// Display dataset information
function displayDatasetInfo(dataset) {
    const datasetInfoDiv = document.getElementById('datasetInfo');
    const datasetDetailsDiv = document.getElementById('datasetDetails');
    
    // Handle both features (GeoJSON) and results formats
    const recordCount = dataset.data.features ? dataset.data.features.length : 
                        (dataset.data.results ? dataset.data.results.length : 0);
    
    datasetDetailsDiv.innerHTML = `
        <div class="info-item">
            <strong>Name:</strong> ${dataset.name || 'Unnamed Dataset'}
        </div>
        <div class="info-item">
            <strong>ID:</strong> <code>${dataset.id}</code>
        </div>
        <div class="info-item">
            <strong>Created:</strong> ${dataset.created}
        </div>
        <div class="info-item">
            <strong>URL:</strong> <a href="${dataset.url}" target="_blank">${dataset.url}</a>
        </div>
        <div class="info-item">
            <strong>Total Records:</strong> ${dataset.data.total || recordCount || 'N/A'}
        </div>
        ${dataset.data.paginationInfo ? `
        <div class="info-item">
            <strong>Pages Fetched:</strong> ${dataset.data.paginationInfo.pagesFetched}
        </div>
        <div class="info-item">
            <strong>Records Fetched:</strong> ${dataset.data.paginationInfo.actualRecords}
        </div>
        ` : ''}
    `;
    
    datasetInfoDiv.style.display = 'block';
}

// Display JSON data
function displayJsonData(dataset) {
    const jsonContainer = document.getElementById('jsonContainer');
    const jsonContent = document.getElementById('jsonContent');
    
    // Pretty print the JSON
    const jsonString = JSON.stringify(dataset, null, 2);
    jsonContent.textContent = jsonString;
    
    jsonContainer.style.display = 'block';
}

// Copy JSON to clipboard
async function copyToClipboard() {
    const copyBtn = document.getElementById('copyBtn');
    const copySuccess = document.getElementById('copySuccess');
    
    try {
        const jsonString = JSON.stringify(currentDataset, null, 2);
        await navigator.clipboard.writeText(jsonString);
        
        // Show success message
        copyBtn.disabled = true;
        copySuccess.style.display = 'inline-block';
        
        setTimeout(() => {
            copyBtn.disabled = false;
            copySuccess.style.display = 'none';
        }, 2000);
        
    } catch (error) {
        console.error('Failed to copy to clipboard:', error);
        // Fallback for older browsers
        const textArea = document.createElement('textarea');
        textArea.value = JSON.stringify(currentDataset, null, 2);
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        
        copyBtn.disabled = true;
        copySuccess.style.display = 'inline-block';
        
        setTimeout(() => {
            copyBtn.disabled = false;
            copySuccess.style.display = 'none';
        }, 2000);
    }
}

// Show error
function showError(message) {
    const errorDiv = document.getElementById('error');
    errorDiv.textContent = message;
    errorDiv.style.display = 'block';
}

// Show loading
function showLoading() {
    document.getElementById('loading').style.display = 'block';
}

// Hide loading
function hideLoading() {
    document.getElementById('loading').style.display = 'none';
}

// Initialize the page
document.addEventListener('DOMContentLoaded', async function() {
    try {
        await initDB();
        
        const datasetId = getDatasetId();
        if (!datasetId) {
            showError('No dataset ID provided. Please select a dataset from the Simple Parser page.');
            hideLoading();
            return;
        }
        
        showLoading();
        
        const dataset = await loadDataset(datasetId);
        if (!dataset) {
            document.getElementById('noData').style.display = 'block';
            hideLoading();
            return;
        }
        
        currentDataset = dataset;
        displayDatasetInfo(dataset);
        displayJsonData(dataset);
        
        hideLoading();
        
    } catch (error) {
        console.error('Error initializing raw page:', error);
        showError('Failed to load dataset');
        hideLoading();
    }
});
