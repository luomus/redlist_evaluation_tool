// App state
let currentDataset = null;
let currentPage = 1;
let totalPages = 1;
let perPage = 100;

// Get dataset ID from URL parameters
function getDatasetId() {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('id');
}

// Load dataset from backend with pagination
async function loadDataset(datasetId, page = 1, recordsPerPage = 100) {
    try {
        const response = await fetch(`/api/observations/${datasetId}?page=${page}&per_page=${recordsPerPage}`);
        if (!response.ok) return null;
        
        const data = await response.json();
        return {
            id: data.dataset_id,
            name: data.dataset_name,
            url: data.dataset_url,
            created_at: data.created_at,
            data: data,
            pagination: data.pagination
        };
    } catch (error) {
        console.error('Error loading dataset:', error);
        return null;
    }
}

// Display dataset information
function displayDatasetInfo(dataset) {
    const datasetInfoDiv = document.getElementById('datasetInfo');
    const datasetDetailsDiv = document.getElementById('datasetDetails');
    
    const pagination = dataset.pagination || {};
    
    datasetDetailsDiv.innerHTML = `
        <div class="info-item">
            <strong>Name:</strong> ${dataset.name || 'Unnamed Dataset'}
        </div>
        <div class="info-item">
            <strong>ID:</strong> <code>${dataset.id}</code>
        </div>
        ${dataset.created_at ? `
        <div class="info-item">
            <strong>Created:</strong> ${new Date(dataset.created_at).toLocaleString()}
        </div>
        ` : ''}
        ${dataset.url ? `
        <div class="info-item">
            <strong>URL:</strong> <a href="${dataset.url}" target="_blank" style="word-break: break-all;">${dataset.url}</a>
        </div>
        ` : ''}
        <div class="info-item">
            <strong>Total Records:</strong> ${pagination.total ? pagination.total.toLocaleString() : 'N/A'}
        </div>
        <div class="info-item">
            <strong>Showing:</strong> Page ${pagination.page || 1} of ${pagination.pages || 1} (${pagination.per_page || 0} per page)
        </div>
    `;
    
    datasetInfoDiv.style.display = 'block';
}

// Display pagination controls
function displayPaginationControls() {
    const paginationDiv = document.getElementById('paginationControls');
    
    if (!paginationDiv) return;
    
    const prevDisabled = currentPage <= 1 ? 'disabled' : '';
    const nextDisabled = currentPage >= totalPages ? 'disabled' : '';
    
    paginationDiv.innerHTML = `
        <div class="pagination">
            <button onclick="loadPage(1)" ${prevDisabled}>First</button>
            <button onclick="loadPage(${currentPage - 1})" ${prevDisabled}>Previous</button>
            <span class="page-info">Page ${currentPage} of ${totalPages}</span>
            <button onclick="loadPage(${currentPage + 1})" ${nextDisabled}>Next</button>
            <button onclick="loadPage(${totalPages})" ${nextDisabled}>Last</button>
            <select id="perPageSelect" onchange="changePerPage(this.value)">
                <option value="50" ${perPage === 50 ? 'selected' : ''}>50 per page</option>
                <option value="100" ${perPage === 100 ? 'selected' : ''}>100 per page</option>
                <option value="250" ${perPage === 250 ? 'selected' : ''}>250 per page</option>
                <option value="500" ${perPage === 500 ? 'selected' : ''}>500 per page</option>
                <option value="1000" ${perPage === 1000 ? 'selected' : ''}>1000 per page</option>
            </select>
        </div>
    `;
}

// Load a specific page
async function loadPage(page) {
    if (page < 1 || page > totalPages) return;
    
    showLoading();
    currentPage = page;
    
    const datasetId = getDatasetId();
    const dataset = await loadDataset(datasetId, currentPage, perPage);
    
    if (dataset) {
        currentDataset = dataset;
        displayDatasetInfo(dataset);
        displayJsonData(dataset);
        displayPaginationControls();
    }
    
    hideLoading();
}

// Change records per page
async function changePerPage(newPerPage) {
    perPage = parseInt(newPerPage);
    currentPage = 1; // Reset to first page
    await loadPage(1);
}

// Display JSON data
function displayJsonData(dataset) {
    const jsonContainer = document.getElementById('jsonContainer');
    const jsonContent = document.getElementById('jsonContent');
    
    // Pretty print the JSON
    const jsonString = JSON.stringify(dataset.data, null, 2);
    jsonContent.textContent = jsonString;
    
    jsonContainer.style.display = 'block';
}

// Copy JSON to clipboard
async function copyToClipboard() {
    const copyBtn = document.getElementById('copyBtn');
    const copySuccess = document.getElementById('copySuccess');
    
    try {
        const jsonString = JSON.stringify(currentDataset.data, null, 2);
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
        textArea.value = JSON.stringify(currentDataset.data, null, 2);
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
        const datasetId = getDatasetId();
        if (!datasetId) {
            showError('No dataset ID provided. Please select a dataset from the Simple Parser page.');
            hideLoading();
            return;
        }
        
        showLoading();
        
        const dataset = await loadDataset(datasetId, currentPage, perPage);
        if (!dataset) {
            document.getElementById('noData').style.display = 'block';
            hideLoading();
            return;
        }
        
        currentDataset = dataset;
        totalPages = dataset.pagination?.pages || 1;
        
        displayDatasetInfo(dataset);
        displayJsonData(dataset);
        displayPaginationControls();
        
        hideLoading();
        
    } catch (error) {
        console.error('Error initializing raw page:', error);
        showError('Failed to load dataset');
        hideLoading();
    }
});
