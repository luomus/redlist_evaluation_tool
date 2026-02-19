// Global variables for fetched data
window.currentFetchedData = null;
window.currentFetchedUrl = null;

// Helper function to add progress log entry
function addProgressLog(message, type = 'success', logElement) {
    const entry = document.createElement('div');
    entry.className = `progress-entry ${type}`;
    entry.textContent = message;
    logElement.appendChild(entry);
    logElement.scrollTop = logElement.scrollHeight;
}

// Helper function to update progress summary
function updateProgressSummary(pagesFetched, totalRecords, totalTime, logElement) {
    const existingSummary = logElement.querySelector('.progress-summary');
    if (existingSummary) {
        existingSummary.remove();
    }
    
    const summary = document.createElement('div');
    summary.className = 'progress-summary';
    summary.innerHTML = `
        <div>Haetut sivut: ${pagesFetched} | Havaintoja yhteensä: ${totalRecords} | Kokonaisaika: ${totalTime.toFixed(2)}s</div>
    `;
    logElement.appendChild(summary);
}

// Fetch all pages of data
async function fetchAllPages(baseUrl, config, logElement) {
    const allResults = [];
    let currentPage = 1;
    let totalRecords = 0;
    let lastPage = 1;
    let pageSize = 1000;
    let totalTime = 0;
    const startTime = Date.now();
    
    try {
        while (currentPage <= 10 && totalRecords < 10000) {
            const pageStartTime = Date.now();
            
            // Build the base query string (access token moved to Authorization header)
            let apiQuery = `pageSize=${pageSize}&` +
                `page=${currentPage}&` +
                `countryId=ML.206&` +
                `individualCountMin=1&` +
                `selected=unit.interpretations.recordQuality,document.linkings.collectionQuality,unit.linkings.taxon.taxonomicOrder,unit.abundanceString,gathering.displayDateTime,gathering.interpretations.countryDisplayname,gathering.interpretations.biogeographicalProvinceDisplayname,gathering.locality,document.collectionId,document.documentId,gathering.team,unit.linkings.taxon.vernacularName,unit.linkings.taxon.scientificName,unit.linkings.taxon.cursiveName,unit.linkings.taxon.latestRedListStatusFinland,unit.linkings.taxon.primaryHabitat,gathering.conversions.dayOfYearBegin,gathering.conversions.dayOfYearEnd,unit.det,unit.abundanceUnit,unit.interpretations.individualCount,unit.lifeStage,unit.sex,unit.atlasCode,unit.atlasClass,gathering.interpretations.coordinateAccuracy,gathering.conversions.wgs84WKT,unit.recordBasis,unit.notes,unit.unitId,unit.linkings.taxon.occurrenceCountFinland,unit.unitId,document.documentId&` +
                `crs=WGS84&` +
                `featureType=ORIGINAL_FEATURE&` +
                `format=geojson`;

            // Add original parameters from the input URL (skip page, pageSize and access_token)
            const urlObj = new URL(baseUrl);
            urlObj.searchParams.forEach((value, key) => {
                if (key !== "page" && key !== "pageSize" && key !== "access_token") {
                    apiQuery += `&${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
                }
            });

            // Final API URL (use server-side proxy to avoid CORS)
            const apiUrl = `/api/laji?${apiQuery}`;
            
            addProgressLog(`Haetaan sivua ${currentPage}...`, 'success', logElement);

            // We proxy through the Flask backend which injects the server-side
            // Authorization and session Person-Token. Only pass optional
            // forwarding headers (Api-Version / Accept-Language) from client.
            const headers = {
                'Api-Version': '1',
                'Accept-Language': 'fi'
            };

            // Debugging: print URL and headers to both console and progress log
            console.debug('LAJI API (proxied) Request', { url: apiUrl, headers });
            addProgressLog(`Pyynnön URL: ${apiUrl}`, 'success', logElement);
            try {
                addProgressLog(`Pyynnön otsikot: ${JSON.stringify(headers)}`, 'success', logElement);
            } catch (e) {
                // Fallback if circular structure or other stringify error
                addProgressLog('Pyynnön otsikot: <ei-sarjoitettava>', 'success', logElement);
                console.error('Failed to stringify headers for logging', e);
            }

            const response = await fetch(apiUrl, { headers });
            if (!response.ok) {
                let respText = '';
                try {
                    respText = await response.text();
                } catch (e) {
                    respText = '<failed to read response body>';
                }
                console.error('API request failed', { url: apiUrl, status: response.status, body: respText });
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            
            const pageTime = (Date.now() - pageStartTime) / 1000;
            totalTime += pageTime;
            
            // Store first page data for metadata
            if (currentPage === 1) {
                lastPage = data.lastPage;
                pageSize = data.pageSize;
                const recordCount = data.features ? data.features.length : 0;
                addProgressLog(`Page ${currentPage}: ${recordCount} records fetched in ${pageTime.toFixed(2)}s (Total available: ${data.total || 'unknown'})`, 'success', logElement);
            } else {
                const recordCount = data.features ? data.features.length : 0;
                addProgressLog(`Page ${currentPage}: ${recordCount} records fetched in ${pageTime.toFixed(2)}s`, 'success', logElement);
            }
            
            // Add features to our collection
            if (data.features && data.features.length > 0) {
                allResults.push(...data.features);
                totalRecords += data.features.length;
            }
            
            // Update progress summary
            updateProgressSummary(currentPage, totalRecords, totalTime, logElement);
            
            // Check if we've reached the end
            if (currentPage >= lastPage || (data.features && data.features.length === 0)) {
                addProgressLog(`Reached end of data (page ${currentPage} of ${lastPage})`, 'success', logElement);
                break;
            }
            
            currentPage++;
        }
        
        const totalElapsedTime = (Date.now() - startTime) / 1000;
        addProgressLog(`Fetching completed! Total time: ${totalElapsedTime.toFixed(2)}s`, 'success', logElement);
        
        // Create combined GeoJSON dataset
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
        addProgressLog(`Error on page ${currentPage}: ${error.message}`, 'error', logElement);
        throw error;
    }
}

// Parse URL and fetch data
window.parseUrl = async function(url, logElement) {
    try {
        // Create URL object to parse the URL
        const urlObj = new URL(url);
        const params = urlObj.searchParams;
        
        if (params.size === 0) {
            throw new Error('URL-osoitteesta ei löytynyt parametreja');
        }
        
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
        const combinedData = await fetchAllPages(baseApiUrl, config, logElement);
        
        // Store data globally for saving
        window.currentFetchedData = combinedData;
        window.currentFetchedUrl = url;
        
        return combinedData;
        
    } catch (error) {
        console.error('URL parsing error:', error);
        throw error;
    }
};
