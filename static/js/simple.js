// App state
let currentApiData = null;
let currentApiUrl = null;
let allPagesData = null;
let isPaginationInProgress = false;

// Generate unique ID
function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

// Helper function to add progress log entry
function addProgressLog(message, type = 'success') {
    const progressLog = document.getElementById('progressLog');
    const entry = document.createElement('div');
    entry.className = `progress-entry ${type}`;
    entry.textContent = message;
    progressLog.appendChild(entry);
    progressLog.scrollTop = progressLog.scrollHeight;
}

// Helper function to update progress summary
function updateProgressSummary(pagesFetched, totalRecords, totalTime) {
    const progressLog = document.getElementById('progressLog');
    const existingSummary = progressLog.querySelector('.progress-summary');
    if (existingSummary) {
        existingSummary.remove();
    }
    
    const summary = document.createElement('div');
    summary.className = 'progress-summary';
    summary.innerHTML = `
        <div>Pages fetched: ${pagesFetched} | Total records: ${totalRecords} | Total time: ${totalTime.toFixed(2)}s</div>
    `;
    progressLog.appendChild(summary);
}

// Save dataset to backend
async function saveDataset() {
    if (!currentApiData) {
        showError('No data to save. Please fetch data first.');
        return;
    }
    
    const datasetName = document.getElementById('datasetName').value.trim();
    
    try {
        const dataset_id = generateId();
        const response = await fetch('/api/observations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                dataset_id: dataset_id,
                dataset_name: datasetName || `Dataset ${new Date().toLocaleString()}`,
                dataset_url: currentApiUrl || '',
                features: currentApiData.features
            })
        });
        
        const result = await response.json();
        if (result.success) {
            showSuccess(`Dataset saved successfully! ${result.count} observations stored.`);
            loadDatasets();
            
            // Clear the name input and hide save section
            document.getElementById('datasetName').value = '';
            document.getElementById('saveSection').style.display = 'none';
            
            // Clear the current data to prevent re-saving
            currentApiData = null;
            currentApiUrl = null;
            allPagesData = null;
        } else {
            showError('Failed to save dataset: ' + result.error);
        }
    } catch (error) {
        console.error('Error saving dataset:', error);
        showError('Failed to save dataset');
    }
}

// Load datasets from backend
async function loadDatasets() {
    try {
        const response = await fetch('/api/datasets');
        const result = await response.json();
        displayDatasets(result.datasets || []);
    } catch (error) {
        console.error('Error loading datasets:', error);
    }
}

// Display datasets in UI
function displayDatasets(datasets) {
    const datasetsDiv = document.getElementById('datasets');
    const datasetsList = document.getElementById('datasetsList');
    
    if (datasets.length === 0) {
        datasetsList.innerHTML = '<p>No datasets saved yet.</p>';
        datasetsDiv.style.display = 'block';
        return;
    }
    
    // Sort by created_at (newest first)
    datasets.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    
    let html = '<div class="dataset-list">';
    datasets.forEach(dataset => {
        html += `
            <div class="dataset-item">
                <div class="dataset-info">
                    <div class="dataset-name"><strong>Name:</strong> ${dataset.name || 'Unnamed Dataset'}</div>
                    <div class="dataset-id"><strong>ID:</strong> ${dataset.id}</div>
                    <div class="dataset-time"><strong>Created:</strong> ${new Date(dataset.created_at).toLocaleString()}</div>
                    <div class="dataset-stats">
                        <strong>Total Records:</strong> ${dataset.count || 'N/A'}
                    </div>
                </div>
                <div class="dataset-actions">
                    <select onchange="handleToolSelection(this, '${dataset.id}')" class="tool-select">
                        <option value="">Select a tool...</option>
                        <option value="/stats">View Stats</option>
                        <option value="/raw">View Raw</option>
                        <option value="/convex_hull">View Convex Hull</option>
                        <option value="/map">View on Map</option>
                    </select>
                    <button onclick="removeDataset('${dataset.id}')" class="remove-btn">Remove</button>
                </div>
            </div>
        `;
    });
    html += '</div>';
    
    datasetsList.innerHTML = html;
    datasetsDiv.style.display = 'block';
}

// Handle tool selection from dropdown
function handleToolSelection(selectElement, datasetId) {
    const selectedTool = selectElement.value;
    if (selectedTool) {
        // Redirect to the selected tool with dataset ID (URL-encode id)
        window.location.href = `${selectedTool}?id=${encodeURIComponent(datasetId)}`;
    }
}

// Remove dataset from backend
async function removeDataset(id) {
    if (!confirm('Are you sure you want to remove this dataset?')) {
        return;
    }
    
    try {
        const response = await fetch(`/api/observations/${id}`, {
            method: 'DELETE'
        });
        const result = await response.json();
        if (result.success) {
            showSuccess('Dataset removed successfully!');
            loadDatasets();
        } else {
            showError('Failed to remove dataset');
        }
    } catch (error) {
        console.error('Error removing dataset:', error);
        showError('Failed to remove dataset');
    }
}

// Show success message
function showSuccess(message) {
    const errorDiv = document.getElementById('error');
    errorDiv.textContent = message;
    errorDiv.style.color = '#155724';
    errorDiv.style.backgroundColor = '#d4edda';
    errorDiv.style.border = '1px solid #c3e6cb';
    errorDiv.style.display = 'block';
    setTimeout(() => {
        errorDiv.style.display = 'none';
    }, 3000);
}

function showError(message) {
    const errorDiv = document.getElementById('error');
    errorDiv.textContent = message;
    errorDiv.style.display = 'block';
}

// Allow Enter key to trigger parsing
document.getElementById('urlInput').addEventListener('keypress', function(e) {
    if (e.key === 'Enter') {
        parseUrl();
    }
});

// Clear results when user starts typing
document.getElementById('urlInput').addEventListener('input', function() {
    const errorDiv = document.getElementById('error');
    const responseDiv = document.getElementById('response');
    const fetchProgress = document.getElementById('fetchProgress');
    errorDiv.style.display = 'none';
    responseDiv.style.display = 'none';
    fetchProgress.style.display = 'none';
    document.getElementById('saveSection').style.display = 'none';
    document.getElementById('saveDatasetBtn').disabled = true;
    
    // Clear any duplicate messages
    const duplicateMessage = responseDiv.querySelector('.duplicate-message');
    if (duplicateMessage) {
        duplicateMessage.remove();
    }
    
    // Clear current data
    currentApiData = null;
    currentApiUrl = null;
    allPagesData = null;
});

// Initialize the app
document.addEventListener('DOMContentLoaded', async function() {
    try {
        await loadDatasets();
    } catch (error) {
        console.error('Failed to initialize app:', error);
        showError('Failed to load datasets');
    }
});
