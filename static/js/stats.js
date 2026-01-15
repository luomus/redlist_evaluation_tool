// IndexedDB setup
let db;

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

// Calculate statistics
function calculateStatistics(dataset) {
    const results = dataset.data.features || dataset.data.results || [];
    const stats = {
        totalRecords: results.length,
        uniqueSpecies: new Set(),
        uniqueLocalities: new Set(),
        uniqueObservers: new Set(),
        dateRange: { earliest: null, latest: null },
        recordBasisCounts: {},
        individualCounts: [],
        observerCounts: {}
    };
    
    results.forEach(record => {
        // Species
        const scientificName = record.properties?.['unit.linkings.taxon.scientificName'];
        if (scientificName) {
            stats.uniqueSpecies.add(scientificName);
        }
        
        // Localities
        const locality = record.properties?.['gathering.locality'];
        if (locality) {
            stats.uniqueLocalities.add(locality);
        }
        
        // Observers - gathering.team is flattened as gathering.team[0], gathering.team[1], etc.
        if (record.properties) {
            Object.keys(record.properties).forEach(key => {
                if (key.startsWith('gathering.team[') && record.properties[key]) {
                    const observer = record.properties[key];
                    stats.uniqueObservers.add(observer);
                    stats.observerCounts[observer] = (stats.observerCounts[observer] || 0) + 1;
                }
            });
        }
        
        // Dates
        const displayDateTime = record.properties?.['gathering.displayDateTime'];
        if (displayDateTime) {
            const dateStr = displayDateTime.split(' ')[0]; // Get date part
            if (!stats.dateRange.earliest || dateStr < stats.dateRange.earliest) {
                stats.dateRange.earliest = dateStr;
            }
            if (!stats.dateRange.latest || dateStr > stats.dateRange.latest) {
                stats.dateRange.latest = dateStr;
            }
        }
        
        // Record basis
        const recordBasis = record.properties?.['unit.recordBasis'] || 'Unknown';
        stats.recordBasisCounts[recordBasis] = (stats.recordBasisCounts[recordBasis] || 0) + 1;
        
        // Individual count
        const individualCount = record.properties?.['unit.interpretations.individualCount'];
        if (individualCount !== undefined && individualCount !== null) {
            stats.individualCounts.push(individualCount);
        }
        
    });
    
    // Calculate individual count statistics
    if (stats.individualCounts.length > 0) {
        const sortedCounts = stats.individualCounts.sort((a, b) => a - b);
        stats.individualCountStats = {
            min: sortedCounts[0],
            max: sortedCounts[sortedCounts.length - 1],
            sum: sortedCounts.reduce((sum, count) => sum + count, 0),
            average: sortedCounts.reduce((sum, count) => sum + count, 0) / sortedCounts.length,
            median: sortedCounts.length % 2 === 0 
                ? (sortedCounts[sortedCounts.length / 2 - 1] + sortedCounts[sortedCounts.length / 2]) / 2
                : sortedCounts[Math.floor(sortedCounts.length / 2)]
        };
    } else {
        stats.individualCountStats = {
            min: 0,
            max: 0,
            sum: 0,
            average: 0,
            median: 0
        };
    }
                
    return stats;
}

// Display dataset information
function displayDatasetInfo(dataset) {
    const datasetInfoDiv = document.getElementById('datasetInfo');
    const datasetDetailsDiv = document.getElementById('datasetDetails');
    
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
            <strong>Total Records:</strong> ${dataset.data.total || 'N/A'}
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

// Display statistics
function displayStatistics(stats, dataset) {
    const statisticsDiv = document.getElementById('statistics');
    const statsContentDiv = document.getElementById('statsContent');
    
    // Sort record basis counts
    const sortedRecordBasis = Object.entries(stats.recordBasisCounts)
        .sort(([,a], [,b]) => b - a);
    
    // Sort observer counts
    const sortedObservers = Object.entries(stats.observerCounts)
        .sort(([,a], [,b]) => b - a)
        .slice(0, 10); // Top 10 observers
    
    // Get a sample record for debugging
    const sampleRecord = (dataset.data.features || dataset.data.results || [])[0];
    const sampleRecordJson = sampleRecord ? JSON.stringify(sampleRecord, null, 2) : 'No records available';
    
    statsContentDiv.innerHTML = `
        <div class="stats-grid">
            <div class="stat-card">
                <h4>Basic Counts</h4>
                <div class="stat-item">
                    <strong>Total Records:</strong> ${stats.totalRecords}
                </div>
                <div class="stat-item">
                    <strong>Unique Species:</strong> ${stats.uniqueSpecies.size}
                </div>
                <div class="stat-item">
                    <strong>Unique Localities:</strong> ${stats.uniqueLocalities.size}
                </div>
                <div class="stat-item">
                    <strong>Unique Observers:</strong> ${stats.uniqueObservers.size}
                </div>
            </div>
            
            <div class="stat-card">
                <h4>Date Range</h4>
                <div class="stat-item">
                    <strong>Earliest:</strong> ${stats.dateRange.earliest || 'N/A'}
                </div>
                <div class="stat-item">
                    <strong>Latest:</strong> ${stats.dateRange.latest || 'N/A'}
                </div>
            </div>
            
            <div class="stat-card">
                <h4>Record Basis</h4>
                ${sortedRecordBasis.map(([basis, count]) => `
                    <div class="stat-item">
                        <strong>${basis}:</strong> ${count}
                    </div>
                `).join('')}
            </div>
            
            <div class="stat-card">
                <h4>Individual Count Statistics</h4>
                <div class="stat-item">
                    <strong>Min:</strong> ${stats.individualCountStats.min}
                </div>
                <div class="stat-item">
                    <strong>Max:</strong> ${stats.individualCountStats.max}
                </div>
                <div class="stat-item">
                    <strong>Average:</strong> ${stats.individualCountStats.average.toFixed(2)}
                </div>
                <div class="stat-item">
                    <strong>Median:</strong> ${stats.individualCountStats.median}
                </div>
                <div class="stat-item">
                    <strong>Sum:</strong> ${stats.individualCountStats.sum}
                </div>
                <div class="stat-item">
                    <strong>Records with Count:</strong> ${stats.individualCounts.length}
                </div>
            </div>
        </div>
        
        <div class="chart-section">
            <h3>Top 10 Observers</h3>
            <div class="bar-chart">
                ${sortedObservers.map(([observer, count], index) => {
                    const maxCount = sortedObservers[0][1];
                    const percentage = (count / maxCount) * 100;
                    return `
                        <div class="bar-item">
                            <div class="bar-label" title="${observer}">${observer}</div>
                            <div class="bar-container">
                                <div class="bar-fill" style="width: ${percentage}%"></div>
                                <div class="bar-value">${count}</div>
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        </div>
    `;
    
    statisticsDiv.style.display = 'block';
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
        
        displayDatasetInfo(dataset);
        const stats = calculateStatistics(dataset);
        displayStatistics(stats, dataset);
        
        hideLoading();
        
    } catch (error) {
        console.error('Error initializing stats page:', error);
        showError('Failed to load dataset statistics');
        hideLoading();
    }
});
