/* global L */

// Threatened species evaluation zones layer management module

(function() {
    // Private state
    let threatenedZonesLayer = null;
    let threatenedZonesVisible = false;
    let isInitialized = false;
    let initPromise = null;

    /**
     * Initialize the threatened species evaluation zones layer as a WMS tile layer.
     * Safely handles failures — map works even if zones fail to load.
     * Returns a promise that resolves when initialization is complete.
     * 
     * @returns {Promise<void>}
     */
    function initializeThreatenedZonesLayer() {
        // Return existing promise if already initializing
        if (initPromise) return initPromise;
        
        // Return immediately if already initialized
        if (isInitialized) return Promise.resolve();

        initPromise = (async () => {
            try {
                // Create WMS tile layer for threatened species evaluation zones
                threatenedZonesLayer = L.tileLayer.wms(
                    'https://geoserver.laji.fi/geoserver/ows',
                    {
                        layers: 'LajiMapData:threatened_species_evaluation_zones',
                        styles: '',
                        format: 'image/png',
                        transparent: true,
                        version: '1.1.0',
                        opacity: 0.5,
                        attribution: '&copy; <a href="https://geoserver.laji.fi">Laji.fi GeoServer</a>',
                        maxZoom: 19
                    }
                );

                // Expose to global scope for backward compatibility
                window.threatenedZonesLayer = threatenedZonesLayer;
                window.threatenedZonesVisible = threatenedZonesVisible;

                console.log('Threatened species evaluation zones layer initialized');
                isInitialized = true;
            } catch (err) {
                console.error('Failed to initialize threatened species evaluation zones:', err);
                isInitialized = true; // Mark as initialized even on error
            }
        })();

        return initPromise;
    }

    /**
     * Get the threatened species evaluation zones layer.
     * Returns null if not yet initialized.
     * 
     * @returns {L.TileLayer.WMS|null}
     */
    function getThreatenedZonesLayer() {
        return threatenedZonesLayer;
    }

    /**
     * Set visibility of threatened species evaluation zones layer on the map.
     * Requires a map reference (typically window.sharedMap).
     * 
     * @param {boolean} visible - Whether to show the layer
     * @param {L.Map} [map] - Leaflet map instance (defaults to window.sharedMap)
     */
    function setThreatenedZonesVisible(visible, map) {
        threatenedZonesVisible = visible;
        window.threatenedZonesVisible = visible; // Keep in sync for backward compatibility

        if (!threatenedZonesLayer) {
            console.warn('Threatened species evaluation zones layer not initialized');
            return;
        }

        const mapRef = map || (window.sharedMap);
        if (!mapRef) {
            console.warn('No map reference available');
            return;
        }

        try {
            if (visible) {
                if (!mapRef.hasLayer(threatenedZonesLayer)) {
                    mapRef.addLayer(threatenedZonesLayer);
                }
            } else {
                if (mapRef.hasLayer(threatenedZonesLayer)) {
                    mapRef.removeLayer(threatenedZonesLayer);
                }
            }
        } catch (err) {
            console.error('Error toggling threatened zones visibility:', err);
        }
    }

    /**
     * Check if threatened species evaluation zones layer is visible.
     * 
     * @returns {boolean}
     */
    function isThreatenedZonesVisible() {
        return threatenedZonesVisible;
    }

    // Export functions to global scope
    window.initializeThreatenedZonesLayer = initializeThreatenedZonesLayer;
    window.getThreatenedZonesLayer = getThreatenedZonesLayer;
    window.setThreatenedZonesVisible = setThreatenedZonesVisible;
    window.isThreatenedZonesVisible = isThreatenedZonesVisible;
})();
