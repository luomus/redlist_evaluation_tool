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
            let apiQuery = `access_token=${encodeURIComponent(config.access_token)}&pageSize=${pageSize}&page=${currentPage}&cache=true&useIdentificationAnnotations=true&includeSubTaxa=true&individualCountMin=1&qualityIssues=NO_ISSUES&selected=unit.interpretations.recordQuality,document.linkings.collectionQuality,unit.linkings.taxon.taxonomicOrder,unit.abundanceString,gathering.displayDateTime,gathering.interpretations.countryDisplayname,gathering.interpretations.biogeographicalProvinceDisplayname,gathering.locality,document.collectionId,document.documentId,gathering.team,unit.linkings.taxon.vernacularName,unit.linkings.taxon.scientificName,unit.linkings.taxon.cursiveName,unit.linkings.taxon.latestRedListStatusFinland,unit.linkings.taxon.primaryHabitat,gathering.conversions.dayOfYearBegin,gathering.conversions.dayOfYearEnd,unit.det,unit.abundanceUnit,unit.interpretations.individualCount,unit.lifeStage,unit.sex,unit.atlasCode,unit.atlasClass,gathering.interpretations.coordinateAccuracy,gathering.conversions.wgs84WKT,unit.recordBasis,unit.notes,unit.unitId,unit.linkings.taxon.occurrenceCountFinland,unit.unitId,document.documentId&crs=WGS84&featureType=ORIGINAL_FEATURE&format=geojson`;

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
        
        // Show save section
        document.getElementById('saveSection').style.display = 'block';
        document.getElementById('saveDatasetBtn').disabled = false;
        
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
