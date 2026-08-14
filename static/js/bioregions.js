/* global L */

// Biogeographical regions layer management module

(function() {
    // Private state
    let bioRegionsLayer = null;
    let bioRegionsVisible = false;
    let isInitialized = false;
    let initPromise = null;

    /**
     * Initialize the biogeographical regions layer and load data from GeoJSON file.
     * Safely handles failures — map works even if bioregions fail to load.
     * Returns a promise that resolves when initialization is complete.
     * 
     * @returns {Promise<void>}
     */
    function initializeBioRegionsLayer() {
        // Return existing promise if already initializing
        if (initPromise) return initPromise;
        
        // Return immediately if already initialized
        if (isInitialized) return Promise.resolve();

        initPromise = (async () => {
            try {
                // Create the layer with styling
                bioRegionsLayer = L.geoJSON(null, {
                    style: {
                        color: '#ff7800',
                        weight: 2,
                        opacity: 0.6,
                        dashArray: '5,5',
                        fill: false
                    },
                    onEachFeature: function(feature, layer) {
                        if (feature.properties && feature.properties.name) {
                            layer.bindPopup(feature.properties.name);
                        }
                    }
                });

                // Expose to global scope for backward compatibility
                window.bioRegionsLayer = bioRegionsLayer;
                window.bioRegionsVisible = bioRegionsVisible;

                // Load biogeographical regions data from local file
                const response = await fetch('/static/resources/biogeographicalProvinces.json');
                console.log('Biogeographical regions fetch response:', response.status, response.statusText);
                
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }

                const data = await response.json();
                console.log('Biogeographical regions data loaded:', data);

                if (data && data.features && data.features.length > 0) {
                    console.log(`Adding ${data.features.length} biogeographical regions to layer`);
                    bioRegionsLayer.addData(data);
                } else {
                    console.warn('No features found in biogeographical regions data');
                }

                isInitialized = true;
            } catch (err) {
                console.error('Failed to load biogeographical regions:', err);
                isInitialized = true; // Mark as initialized even on error
            }
        })();

        return initPromise;
    }

    /**
     * Get the biogeographical regions layer.
     * Returns null if not yet initialized.
     * 
     * @returns {L.GeoJSON|null}
     */
    function getBioRegionsLayer() {
        return bioRegionsLayer;
    }

    /**
     * Set visibility of biogeographical regions layer on the map.
     * Requires a map reference (typically window.sharedMap).
     * 
     * @param {boolean} visible - Whether to show the layer
     * @param {L.Map} [map] - Leaflet map instance (defaults to window.sharedMap)
     */
    function setBioRegionsVisible(visible, map) {
        bioRegionsVisible = visible;
        window.bioRegionsVisible = visible; // Keep in sync for backward compatibility

        if (!bioRegionsLayer) {
            console.warn('Biogeographical regions layer not initialized');
            return;
        }

        const mapRef = map || (window.sharedMap);
        if (!mapRef) {
            console.warn('No map reference available');
            return;
        }

        try {
            if (visible) {
                if (!mapRef.hasLayer(bioRegionsLayer)) {
                    mapRef.addLayer(bioRegionsLayer);
                }
            } else {
                if (mapRef.hasLayer(bioRegionsLayer)) {
                    mapRef.removeLayer(bioRegionsLayer);
                }
            }
        } catch (err) {
            console.error('Error toggling biogeographical regions visibility:', err);
        }
    }

    /**
     * Check if biogeographical regions layer is visible.
     * 
     * @returns {boolean}
     */
    function isBioRegionsVisible() {
        return bioRegionsVisible;
    }

    // Export functions to global scope
    window.initializeBioRegionsLayer = initializeBioRegionsLayer;
    window.getBioRegionsLayer = getBioRegionsLayer;
    window.setBioRegionsVisible = setBioRegionsVisible;
    window.isBioRegionsVisible = isBioRegionsVisible;
})();
