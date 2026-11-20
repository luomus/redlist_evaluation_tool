/* global L */

// Utility functions shared across map modules

// Add Finnish observation field names here; unmapped fields retain their original names.
const observationFieldLabels = Object.freeze({
    'unit.linkings.taxon.scientificName': 'Laji',
    'gathering.locality': 'Paikka',
    'gathering.displayDateTime': 'Päivämäärä',
    'unit.interpretations.individualCount': 'Lukumäärä',
    'unit.interpretations.recordQuality': 'Havainnon laatu',
    'unit.recordBasis': 'Havaintotapa',
    'unit.unitId': 'Havainnon tunniste',
    'gathering.team': 'Havainnoijat',
    'gathering.interpretations.coordinateAccuracy': 'Koordinaattien tarkkuus',
    'document.collectionId': 'Aineiston tunnus',
    'unit.abundanceString': 'Määrä',
    'gathering.interpretations.biogeographicalProvinceDisplayname': 'Eliömaakunta',
    'gathering.interpretations.countryDisplayname': 'Maa',
    'gathering.eventDate.begin': 'Keruun aloituspäivämäärä',
    'gathering.conversions.dayOfYearBegin': 'Keruun aloituspäivä vuodessa',
    'gathering.conversions.dayOfYearEnd': 'Keruun lopetuspäivä vuodessa',
    'gathering.eventDate.end': 'Keruun lopetuspäivämäärä',
    'gathering.gatheringId': 'Keruutapahtuman tunniste',
    'unit.breedingSite': 'Pesintäpaikka',
    'unit.det': 'Määrittäjä',
    'unit.lifeStage': 'Elinvaihe',
    'unit.linkings.taxon.id': 'Taksonin tunniste',
    'unit.notes': 'Havainnon lisätiedot',
    'unit.sex': 'Sukupuoli',
    'unit.taxonVerbatim': 'Alkuperäinen nimi',
    'document.documentId': 'Havaintoerän tunniste',
    'document.notes': 'Havaintoerän lisätiedot',
    'document.secureReasons': 'Karkeistuksen syy',
    'gathering.conversions.eurefWKT': 'ETRS-TM35FIN WKT',
    'gathering.notes': 'Keruutapahtuman lisätiedot',
    'unit.keywords': 'Avainsanat',
    'unit.linkings.taxon.nameEnglish': 'Englanninkielinen nimi',
    'unit.linkings.taxon.nameFinnish': 'Suomenkielinen nimi',
    'unit.linkings.taxon.nameSwedish': 'Ruotsinkielinen nimi',
    'unit.linkings.taxon.taxonomicOrder': 'Taksonominen järjestys',
    'document.linkings.collectionQuality': 'Aineiston laatu',
    'unit.linkings.taxon.latestRedListStatusFinland.status': 'Uhanalaisuusluokka',
    'unit.linkings.taxon.administrativeStatuses': 'Hallinnollinen asema',
    'unit.linkings.taxon.sensitive': 'Sensitiivinen laji',
    'gathering.conversions.eurefCenterPoint.lat': 'ETRS-TM35FIN N',
    'gathering.conversions.eurefCenterPoint.lon': 'ETRS-TM35FIN E',
    'gathering.conversions.wgs84WKT': 'WGS84 WKT',
    'unit.abundanceUnit': 'Määrän yksikkö',
    'unit.linkings.taxon.primaryHabitat.habitat': 'Ensisijainen biotooppi',
    'unit.atlasClass': 'Atlasluokka',
    'unit.atlasCode': 'Atlaskoodi',
    'document.siteStatus': 'Seurantapaikan tila',
    'document.siteType': 'Seurantapaikan tyyppi',
    'gathering.stateLand': 'Valtion maalla',
    'unit.linkings.taxon.threatenedStatus': 'Lajiturva',
    'unit.linkings.taxon.vernacularName': 'Yleiskielinen nimi',
    'unit.linkings.taxon.vernacularName.fi': 'Yleiskielinen nimi',
    'document.loadDate': 'Latauspäivämäärä',
    'unit.linkings.taxon.informalTaxonGroups': 'Eliöryhmä',
    'gathering.interpretations.municipalityDisplayname': 'Kunta'
});

window.getObservationFieldLabel = function(field) {
    const key = Object.prototype.hasOwnProperty.call(observationFieldLabels, field)
        ? field
        : field.replace(/\[\d+\]/g, '');
    return Object.prototype.hasOwnProperty.call(observationFieldLabels, key)
        ? observationFieldLabels[key]
        : field;
};

/**
 * Determine accuracy class from coordinateAccuracy value (in meters)
 * Classes: 1-10m, 11-100m, 101-1000m, 1001-10000m, 10001-100000m
 * 
 * @param {number|string} coordinateAccuracy - The coordinate accuracy in meters
 * @returns {string|null} - CSS class name like 'accuracy-1-10' or null if no match
 */
window.getAccuracyClass = function(coordinateAccuracy) {
    if (!coordinateAccuracy) return null;
    
    const accuracy = parseFloat(coordinateAccuracy);
    if (isNaN(accuracy)) return null;
    
    if (accuracy <= 10) return 'accuracy-1-10';
    if (accuracy <= 100) return 'accuracy-11-100';
    if (accuracy <= 1000) return 'accuracy-101-1000';
    if (accuracy <= 10000) return 'accuracy-1001-10000';
    if (accuracy <= 100000) return 'accuracy-10001-100000';
    
    return null;
};

/**
 * Format ISO 8601 timestamp using Finnish date and time conventions.
 * 
 * @param {string} iso - ISO 8601 formatted timestamp
 * @returns {string} - Formatted date/time string or original input if invalid
 */
window.formatIsoTimestamp = function(iso) {
    if (!iso) return '-';
    const d = new Date(iso);
    if (isNaN(d)) return iso;
    return d.toLocaleString('fi-FI');
};

/**
 * Format an area as whole square kilometres with Finnish thousands separators.
 *
 * @param {number|string} areaKm2 - Area in square kilometres
 * @returns {string} Formatted area or '-' if invalid
 */
window.formatAreaKm2 = function(areaKm2) {
    const area = Number(areaKm2);
    if (!Number.isFinite(area)) return '-';
    return Math.round(area).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
};
