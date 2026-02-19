// App state
let currentDataset = null;

// Get dataset ID from URL parameters
function getDatasetId() {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('id');
}

// Load dataset statistics from backend (no need to load all data)
async function loadDatasetStats(datasetId) {
    try {
        const response = await fetch(`/api/observations/${datasetId}/stats`);
        if (!response.ok) return null;
        
        const data = await response.json();
        if (!data.success) {
            console.error('Failed to load stats:', data.error);
            return null;
        }
        
        return data;
    } catch (error) {
        console.error('Error loading dataset stats:', error);
        return null;
    }
}

// Display dataset information
function displayDatasetInfo(statsData) {
    const datasetInfoDiv = document.getElementById('datasetInfo');
    const datasetDetailsDiv = document.getElementById('datasetDetails');
    
    datasetDetailsDiv.innerHTML = `
        <div class="info-item">
            <strong>Nimi:</strong> ${statsData.dataset_name || 'Nimetön aineisto'}
        </div>
        <div class="info-item">
            <strong>Tunniste:</strong> <code>${statsData.dataset_id}</code>
        </div>
        ${ (statsData.dataset_created_at || statsData.created_at) ? `
        <div class="info-item">
            <strong>Luotu:</strong> ${new Date(statsData.dataset_created_at || statsData.created_at).toLocaleString()}
        </div>
        ` : ''}
        ${statsData.dataset_url ? `
        <div class="info-item">
            <strong>URL:</strong> <a href="${statsData.dataset_url}" target="_blank" style="word-break: break-all;">${statsData.dataset_url}</a>
        </div>
        ` : ''}
        <div class="info-item">
            <strong>Havaintoja yhteensä:</strong> ${statsData.stats.totalRecords}
        </div>
    `;
    
    datasetInfoDiv.style.display = 'block';
}

// Display statistics
function displayStatistics(statsData) {
    const statisticsDiv = document.getElementById('statistics');
    const statsContentDiv = document.getElementById('statsContent');
    
    const stats = statsData.stats;
    
    // Sort record basis counts
    const sortedRecordBasis = Object.entries(stats.recordBasisCounts)
        .sort(([,a], [,b]) => b - a);
    
    statsContentDiv.innerHTML = `
        <div class="stats-grid">
            <div class="stat-card">
                <h4>Perustiedot</h4>
                <div class="stat-item">
                    <strong>Havaintoja yhteensä:</strong> ${stats.totalRecords.toLocaleString()}
                </div>
                <div class="stat-item">
                    <strong>Eri lajit:</strong> ${stats.uniqueSpecies.toLocaleString()}
                </div>
                <div class="stat-item">
                    <strong>Eri havaintopaikat:</strong> ${stats.uniqueLocalities.toLocaleString()}
                </div>
                <div class="stat-item">
                    <strong>Eri havainnoitsijat:</strong> ${stats.uniqueObservers.toLocaleString()}
                </div>
            </div>
            
            <div class="stat-card">
                <h4>Ajanjakso</h4>
                <div class="stat-item">
                    <strong>Varhaisin:</strong> ${stats.dateRange.earliest || 'N/A'}
                </div>
                <div class="stat-item">
                    <strong>Viimeisin:</strong> ${stats.dateRange.latest || 'N/A'}
                </div>
            </div>
            
            <div class="stat-card">
                <h4>Havainnon tyyppi</h4>
                ${sortedRecordBasis.map(([basis, count]) => `
                    <div class="stat-item">
                        <strong>${basis}:</strong> ${count.toLocaleString()}
                    </div>
                `).join('')}
            </div>
            
            ${stats.individualCountStats ? `
            <div class="stat-card">
                <h4>Yksilölukumäärän tilastot</h4>
                <div class="stat-item">
                    <strong>Minimi:</strong> ${stats.individualCountStats.min}
                </div>
                <div class="stat-item">
                    <strong>Maksimi:</strong> ${stats.individualCountStats.max}
                </div>
                <div class="stat-item">
                    <strong>Keskiarvo:</strong> ${stats.individualCountStats.average.toFixed(2)}
                </div>
                <div class="stat-item">
                    <strong>Summa:</strong> ${stats.individualCountStats.sum.toLocaleString()}
                </div>
                <div class="stat-item">
                    <strong>Havaintoja, joissa lukumäärä ilmoitettu:</strong> ${stats.individualCountStats.count.toLocaleString()}
                </div>
            </div>
            ` : ''}
        </div>
        
        ${stats.topSpecies && stats.topSpecies.length > 0 ? `
        <div class="chart-section">
            <h3>Kymmenen yleisintä lajia</h3>
            <div class="bar-chart">
                ${stats.topSpecies.map((item, index) => {
                    const maxCount = stats.topSpecies[0].count;
                    const percentage = (item.count / maxCount) * 100;
                    return `
                        <div class="bar-item">
                            <div class="bar-label" title="${item.species}">${item.species}</div>
                            <div class="bar-container">
                                <div class="bar-fill" style="width: ${percentage}%"></div>
                                <div class="bar-value">${item.count.toLocaleString()}</div>
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        </div>
        ` : ''}
        
        ${stats.topObservers && stats.topObservers.length > 0 ? `
        <div class="chart-section">
            <h3>Kymmenen aktiivisinta havainnoitsijaa</h3>
            <div class="bar-chart">
                ${stats.topObservers.map((item, index) => {
                    const maxCount = stats.topObservers[0].count;
                    const percentage = (item.count / maxCount) * 100;
                    return `
                        <div class="bar-item">
                            <div class="bar-label" title="${item.observer}">${item.observer}</div>
                            <div class="bar-container">
                                <div class="bar-fill" style="width: ${percentage}%"></div>
                                <div class="bar-value">${item.count.toLocaleString()}</div>
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        </div>
        ` : ''}
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
        const datasetId = getDatasetId();
        if (!datasetId) {
            showError('Aineiston tunnusta ei annettu. Valitse aineisto etusivulta.');
            hideLoading();
            return;
        }
        
        showLoading();
        
        const statsData = await loadDatasetStats(datasetId);
        if (!statsData) {
            document.getElementById('noData').style.display = 'block';
            hideLoading();
            return;
        }
        
        displayDatasetInfo(statsData);
        displayStatistics(statsData);
        
        hideLoading();
        
    } catch (error) {
        console.error('Error initializing stats page:', error);
        showError('Tilastojen lataaminen epäonnistui');
        hideLoading();
    }
});
