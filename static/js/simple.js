// IndexedDB setup
let db;
let currentApiData = null;
let currentApiUrl = null;
let allPagesData = null;
let isPaginationInProgress = false;

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

// Generate unique ID
function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

// Generate hash for duplicate detection
async function generateDatasetHash(url, totalResults) {
    const encoder = new TextEncoder();
    const data = encoder.encode(url + '|' + (totalResults || 0));
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Check if dataset is duplicate
async function checkForDuplicate(url, totalResults) {
    try {
        const hash = await generateDatasetHash(url, totalResults);
        const transaction = db.transaction(['datasets'], 'readonly');
        const store = transaction.objectStore('datasets');
        const request = store.getAll();
        
        return new Promise((resolve) => {
            request.onsuccess = () => {
                const datasets = request.result;
                const duplicate = datasets.find(dataset => dataset.hash === hash);
                resolve(duplicate || null);
            };
            request.onerror = () => resolve(null);
        });
    } catch (error) {
        console.error('Error checking for duplicate:', error);
        return null;
    }
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

// Fetch all pages of data
async function fetchAllPages(baseUrl, config) {
    const allResults = [];
    let currentPage = 1;
    let totalRecords = 0;
    let lastPage = 1;
    let pageSize = 1000;
    let totalTime = 0;
    const startTime = Date.now();
    
    isPaginationInProgress = true;
    
    // Show progress section
    document.getElementById('fetchProgress').style.display = 'block';
    document.getElementById('progressLog').innerHTML = '';
    
    try {
        while (currentPage <= 10 && totalRecords < 10000) {
            const pageStartTime = Date.now();
            
            // Build the base query string
            let apiQuery = `access_token=${encodeURIComponent(config.access_token)}&pageSize=${pageSize}&page=${currentPage}&cache=true&useIdentificationAnnotations=true&includeSubTaxa=true&individualCountMin=1&qualityIssues=NO_ISSUES&selected=unit.interpretations.recordQuality,document.linkings.collectionQuality,unit.linkings.taxon.taxonomicOrder,unit.abundanceString,gathering.displayDateTime,gathering.interpretations.countryDisplayname,gathering.interpretations.biogeographicalProvinceDisplayname,gathering.locality,document.collectionId,document.documentId,gathering.team,unit.linkings.taxon.vernacularName,unit.linkings.taxon.scientificName,unit.linkings.taxon.cursiveName,unit.linkings.taxon.latestRedListStatusFinland,unit.linkings.taxon.primaryHabitat,gathering.conversions.dayOfYearBegin,gathering.conversions.dayOfYearEnd,unit.det,unit.abundanceUnit,unit.interpretations.individualCount,unit.lifeStage,unit.sex,unit.atlasCode,unit.atlasClass,gathering.interpretations.coordinateAccuracy,gathering.conversions.wgs84WKT,unit.recordBasis,unit.notes,unit.unitId,unit.linkings.taxon.occurrenceCountFinland,unit.unitId,document.documentId&crs=EUREF&featureType=ORIGINAL_FEATURE&format=geojson`;

            // Add original parameters from the input URL
            const urlObj = new URL(baseUrl);
            urlObj.searchParams.forEach((value, key) => {
            if (key !== "page" && key !== "pageSize") {
                apiQuery += `&${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
            }
            });

            // Final API URL
            const apiUrl = `${config.base_url}?${apiQuery}`;
            
            addProgressLog(`Fetching page ${currentPage}...`);

            // Log the URL for debugging
            console.log('Fetching API URL:', apiUrl);

            const response = await fetch(apiUrl);
            if (!response.ok) {
                // Try to read response body for more detailed error
                let respText = '';
                try {
                    respText = await response.text();
                } catch (e) {
                    respText = '<failed to read response body>';
                }
                console.error('API request failed', { url: apiUrl, status: response.status, body: respText });
                throw new Error(`HTTP error! status: ${response.status} body: ${respText}`);
            }

            const data = await response.json();
            
            const pageTime = (Date.now() - pageStartTime) / 1000;
            totalTime += pageTime;
            
            // Store first page data for metadata
            if (currentPage === 1) {
                lastPage = data.lastPage || 1;
                pageSize = data.pageSize || 1000;
                const recordCount = data.features ? data.features.length : 0;
                addProgressLog(`Page ${currentPage}: ${recordCount} records fetched in ${pageTime.toFixed(2)}s (Total available: ${data.total || 'unknown'})`);
            } else {
                const recordCount = data.features ? data.features.length : 0;
                addProgressLog(`Page ${currentPage}: ${recordCount} records fetched in ${pageTime.toFixed(2)}s`);
            }
            
            // Add features to our collection
            if (data.features && data.features.length > 0) {
                allResults.push(...data.features);
                totalRecords += data.features.length;
            }
            
            // Update progress summary
            updateProgressSummary(currentPage, totalRecords, totalTime);
            
            // Check if we've reached the end
            if (currentPage >= lastPage || (data.features && data.features.length === 0)) {
                addProgressLog(`Reached end of data (page ${currentPage} of ${lastPage})`);
                break;
            }
            
            currentPage++;
        }
        
        const totalElapsedTime = (Date.now() - startTime) / 1000;
        addProgressLog(`Fetching completed! Total time: ${totalElapsedTime.toFixed(2)}s`, 'success');
        
        // Create combined GeoJSON dataset
        // Note: API returns flattened GeoJSON where nested properties like
        // unit.linkings.taxon.scientificName are stored as flat field names:
        // e.g., properties['unit.linkings.taxon.scientificName']
        const combinedData = {
            type: "FeatureCollection",
            currentPage: 1,
            nextPage: null,
            lastPage: 1,
            pageSize: totalRecords,
            total: totalRecords,
            features: allResults,
            paginationInfo: {
                pagesFetched: currentPage - 1,
                maxPages: 10,
                maxRecords: 10000,
                actualRecords: totalRecords
            }
        };
        
        return combinedData;
        
    } catch (error) {
        console.error('Error fetching pages:', error);
        addProgressLog(`Error on page ${currentPage}: ${error.message}`, 'error');
        throw error;
    } finally {
        isPaginationInProgress = false;
    }
}

// Save dataset to IndexedDB
async function saveDataset() {
    if (!currentApiData) {
        showError('No data to save. Please fetch data first.');
        return;
    }
    
    const datasetName = document.getElementById('datasetName').value.trim();
    
    try {
        const hash = await generateDatasetHash(currentApiUrl, currentApiData.total);
        const transaction = db.transaction(['datasets'], 'readwrite');
        const store = transaction.objectStore('datasets');
        
        const dataset = {
            id: generateId(),
            hash: hash,
            name: datasetName || `Dataset ${new Date().toLocaleString()}`,
            url: currentApiUrl,
            data: currentApiData,
            timestamp: new Date().toISOString(),
            created: new Date().toLocaleString()
        };
        
        await store.add(dataset);
        showSuccess('Dataset saved successfully!');
        loadDatasets();
        
        // Clear the name input and hide save section
        document.getElementById('datasetName').value = '';
        document.getElementById('saveSection').style.display = 'none';
        
        // Clear the current data to prevent re-saving
        currentApiData = null;
        currentApiUrl = null;
        allPagesData = null;
    } catch (error) {
        console.error('Error saving dataset:', error);
        showError('Failed to save dataset');
    }
}

// Load datasets from IndexedDB
async function loadDatasets() {
    try {
        const transaction = db.transaction(['datasets'], 'readonly');
        const store = transaction.objectStore('datasets');
        const request = store.getAll();
        
        request.onsuccess = () => {
            const datasets = request.result;
            displayDatasets(datasets);
        };
        
        request.onerror = () => {
            console.error('Error loading datasets');
        };
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
    
    // Sort by timestamp (newest first)
    datasets.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    
    let html = '<div class="dataset-list">';
    datasets.forEach(dataset => {
        html += `
            <div class="dataset-item">
                <div class="dataset-info">
                    <div class="dataset-name"><strong>Name:</strong> ${dataset.name || 'Unnamed Dataset'}</div>
                    <div class="dataset-id"><strong>ID:</strong> ${dataset.id}</div>
                    <div class="dataset-url"><strong>URL:</strong> ${dataset.url}</div>
                    <div class="dataset-time"><strong>Created:</strong> ${dataset.created}</div>
                    <div class="dataset-stats">
                        <strong>Total Results:</strong> ${dataset.data.total || 'N/A'} | 
                        <strong>Page Size:</strong> ${dataset.data.pageSize || 'N/A'}
                    </div>
                </div>
                <div class="dataset-actions">
                    <select onchange="handleToolSelection(this, '${dataset.id}')" class="tool-select">
                        <option value="">Select a tool...</option>
                        <option value="/stats">View Stats</option>
                        <option value="/raw">View Raw</option>
                        <option value="/convex_hull">View Convex Hull</option>
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
        // Redirect to the selected tool with dataset ID
        window.location.href = `${selectedTool}?id=${datasetId}`;
    }
}

// Remove dataset from IndexedDB
async function removeDataset(id) {
    if (!confirm('Are you sure you want to remove this dataset?')) {
        return;
    }
    
    try {
        const transaction = db.transaction(['datasets'], 'readwrite');
        const store = transaction.objectStore('datasets');
        await store.delete(id);
        showSuccess('Dataset removed successfully!');
        loadDatasets();
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

async function parseUrl() {
    const urlInput = document.getElementById('urlInput');
    const errorDiv = document.getElementById('error');
    const responseDiv = document.getElementById('response');
    
    // Clear previous results
    errorDiv.style.display = 'none';
    responseDiv.style.display = 'none';
    
    const url = urlInput.value.trim();
    
    if (!url) {
        showError('Please enter a URL');
        return;
    }
    
    try {
        // Create URL object to parse the URL
        const urlObj = new URL(url);
        const params = urlObj.searchParams;
        
        if (params.size === 0) {
            showError('No parameters found in the URL');
            return;
        }
        
        // Generate API URL and call it immediately
        await generateApiUrlAndCall(params);
        
    } catch (error) {
        showError('Invalid URL format. Please check your URL and try again.');
        console.error('URL parsing error:', error);
    }
}

async function generateApiUrlAndCall(params) {
    try {
        // Fetch config from Flask app
        const configResponse = await fetch('/api/config');
        const config = await configResponse.json();
        
        // Build the base URL with parameters
        const baseUrl = config.base_url;
        const apiParams = new URLSearchParams();
        
        // Add all parameters from the input URL as they are
        params.forEach((value, key) => {
            apiParams.set(key, value);
        });
        
        const baseApiUrl = `${baseUrl}?${apiParams.toString()}`;
        
        // Fetch all pages
        await fetchAllPagesAndCall(baseApiUrl, config);
    } catch (error) {
        console.error('Config fetch error:', error);
        showError('Failed to load configuration');
    }
}

// Fetch all pages and call the display function
async function fetchAllPagesAndCall(baseUrl, config) {
    const parseBtn = document.getElementById('parseBtn');
    const responseDiv = document.getElementById('response');
    const responseData = document.getElementById('responseData');
    const errorDiv = document.getElementById('error');
    const fetchProgress = document.getElementById('fetchProgress');
    
    // Show loading state
    parseBtn.disabled = true;
    parseBtn.textContent = 'Fetching all pages...';
    responseDiv.style.display = 'block';
    responseData.innerHTML = '';
    fetchProgress.style.display = 'none';
    errorDiv.style.display = 'none';
    
    try {
        const combinedData = await fetchAllPages(baseUrl, config);
        
        // Store data for saving
        currentApiData = combinedData;
        currentApiUrl = baseUrl;
        
        // Display pagination summary
        const summary = {
            currentPage: combinedData.currentPage || 'N/A',
            nextPage: combinedData.nextPage || 'N/A',
            lastPage: combinedData.lastPage || 'N/A',
            pageSize: combinedData.pageSize || 'N/A',
            total: combinedData.total || 'N/A',
            pagesFetched: combinedData.paginationInfo?.pagesFetched || 'N/A',
            actualRecords: combinedData.paginationInfo?.actualRecords || 'N/A'
        };
        
        responseData.innerHTML = `
            <div><strong>Total Records Fetched:</strong> ${summary.actualRecords}</div>
            <div><strong>Pages Fetched:</strong> ${summary.pagesFetched}</div>
            <div><strong>Original Total Available:</strong> ${summary.total}</div>
            <div><strong>Records per Page:</strong> ${summary.pageSize}</div>
        `;
        
        // Check for duplicates
        const duplicate = await checkForDuplicate(baseUrl, combinedData.total);
        if (duplicate) {
            // Show duplicate message instead of save section
            const duplicateMessage = document.createElement('div');
            duplicateMessage.className = 'duplicate-message';
            duplicateMessage.innerHTML = `
                <div style="background-color: #fff3cd; border: 1px solid #ffeaa7; padding: 15px; border-radius: 4px; margin-top: 15px;">
                    <strong>This is duplicate of "${duplicate.name}"</strong><br>
                    <small>Same URL and result count already saved on ${duplicate.created}</small>
                </div>
            `;
            responseData.appendChild(duplicateMessage);
        } else {
            // Show save section
            document.getElementById('saveSection').style.display = 'block';
            document.getElementById('saveDatasetBtn').disabled = false;
        }
        
    } catch (error) {
        console.error('API call error:', error);
        responseData.innerHTML = '';
        fetchProgress.style.display = 'none';
        showError(`Error: ${error.message}`);
    } finally {
        // Hide loading state
        parseBtn.disabled = false;
        parseBtn.textContent = 'Get data';
    }
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
        await initDB();
        await loadDatasets();
    } catch (error) {
        console.error('Failed to initialize app:', error);
        showError('Failed to initialize database');
    }
});
