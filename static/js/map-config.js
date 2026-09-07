/* global L */

// ─────────────────────────────────────────────────────────────────────────
// Configuration: basemaps, constants, and hardcoded values
// ─────────────────────────────────────────────────────────────────────────

// MML WMTS templates for background maps
// Correct WMTS REST ordering: layer / style / tileMatrixSet / z / row / col
window.mapConfig = {
    mmlTaustakarttaTemplate: 'https://avoin-karttakuva.maanmittauslaitos.fi/avoin/wmts/1.0.0/taustakartta/default/WGS84_Pseudo-Mercator/{z}/{y}/{x}.png',
    mmlMaastokarttaTemplate: 'https://avoin-karttakuva.maanmittauslaitos.fi/avoin/wmts/1.0.0/maastokartta/default/WGS84_Pseudo-Mercator/{z}/{y}/{x}.png',
    
    // Default map center and zoom
    defaultCenter: [60.1699, 24.9384],
    defaultZoom: 6,
    
    // Pane z-index ordering for geometry layers
    panes: {
        observationPolygonPane: { zIndex: 410 },
        observationLinePane: { zIndex: 420 },
        observationPointPane: { zIndex: 430 }
    },
    
    // Geometry display settings
    geometry: {
        pointRadius: 7,
        lineWeight: 7,
        lineOpacity: 0.8,
        polygonWeight: 2,
        polygonOpacity: 0.8,
        polygonFillOpacity: 0.2
    },
    
    // Polygon selector tool settings
    polygonSelector: {
        tempLineColor: '#3388ff',
        tempLineDashArray: '5,5',
        markerRadius: 4,
        markerColor: '#3388ff',
        markerFillOpacity: 1,
        startMarkerRadius: 6,
        startMarkerColor: '#e67e22',
        startMarkerFillOpacity: 0.9,
        selectionPolygonColor: '#f39c12',
        selectionPolygonWeight: 2,
        selectionPolygonFillOpacity: 0.15,
        snapDistance: 10 // pixels
    },
    
    // Multi-feature click detection settings
    multiFeature: {
        pixelRadius: 10 // pixels
    },
    
    // Geometry conversion tool settings
    conversion: {
        refLineColor: '#3b82f6',
        refLineWeight: 2,
        refLineOpacity: 0.8,
        refFillColor: '#3b82f6',
        refFillOpacity: 0.08,
        refDashArray: '6,4',
        markerSize: [20, 20],
        markerAnchor: [10, 10]
    }
};

/**
 * Define available basemaps with tile layer configurations
 */
window.basemaps = {
    osm: {
        name: 'OpenStreetMap',
        tileLayers: [
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
                maxZoom: 19
            })
        ]
    },
    cartodark: {
        name: 'CartoDB Positron',
        tileLayers: [
            L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png' + (window.CARTO_BASEMAP_API_KEY ? '?key=' + encodeURIComponent(window.CARTO_BASEMAP_API_KEY) : ''), {
                attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
                subdomains: 'abcd',
                maxZoom: 20
            })
        ]
    },
    taustakartta: {
        name: 'Taustakartta (MML)',
        tileLayers: [
            (function(){
                const _mmlProxyTemplate = '/mml/taustakartta/{z}/{x}/{y}.png';
                const _taustakarttaTileUrl = window.MML_API_KEY
                    ? (window.mapConfig.mmlTaustakarttaTemplate + '?user-id=' + encodeURIComponent(window.MML_API_KEY))
                    : _mmlProxyTemplate;
                return L.tileLayer(_taustakarttaTileUrl, {
                    attribution: '&copy; <a href="https://www.maanmittauslaitos.fi/">Maanmittauslaitos</a>',
                    maxZoom: 20,
                    crossOrigin: true
                });
            })()
        ]
    },
    maastokartta: {
        name: 'Maastokartta (MML)',
        tileLayers: [
            (function(){
                const _mmlProxyTemplate = '/mml/maastokartta/{z}/{x}/{y}.png';
                const _maastoTileUrl = window.MML_API_KEY
                    ? (window.mapConfig.mmlMaastokarttaTemplate + '?user-id=' + encodeURIComponent(window.MML_API_KEY))
                    : _mmlProxyTemplate;
                return L.tileLayer(_maastoTileUrl, {
                    attribution: '&copy; <a href="https://www.maanmittauslaitos.fi/">Maanmittauslaitos</a>',
                    maxZoom: 20,
                    crossOrigin: true
                });
            })()
        ]
    }
};

// Track current basemap
window.currentBasemap = 'osm';
