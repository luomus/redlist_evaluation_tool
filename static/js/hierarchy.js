/**
 * hierarchy.js – Accordion-based taxon hierarchy browser.
 *
 * Renders the taxon tree fetched from /api/taxons/tree as a
 * collapsible accordion on the main page.  Leaf nodes show their
 * species (projects) loaded lazily via /api/taxons/<id>/children.
 */

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let taxonTree = [];          // full tree from API
let expandedTaxons = new Set(); // ids of currently expanded taxons
let searchQuery = '';         // current search string

// Performance optimizations
let renderHierarchyTimeout = null;  // debounce timer
let searchMemoCache = {};           // { queryLower: { groupMatches, speciesMatches } }

// Lazy-loading state for species (projects) per taxon
let loadingTaxons = new Set();      // taxon ids currently being fetched

// Cache management
const CACHE_KEY = 'taxonTreeCache'; // lightweight tree (no species data)
const CACHE_TIMESTAMP_KEY = 'taxonTreeCacheTimestamp';
const CACHE_TTL_MINUTES = 30; // Cache valid for 30 minutes

// One-time migration: remove old heavy cache keys from users' browsers
(function migrateOldCache() {
    try {
        localStorage.removeItem('hierarchyCache');
        localStorage.removeItem('hierarchyCacheTimestamp');
    } catch (e) { /* ignore */ }
})();

// Restore persisted accordion state from previous page visit
(function restoreAccordionState() {
    try {
        const saved = localStorage.getItem('expandedTaxons');
        if (saved) expandedTaxons = new Set(JSON.parse(saved));
    } catch (e) { /* ignore */ }
})();

// Check if cached hierarchy is still valid
function isCacheValid() {
    try {
        const timestamp = localStorage.getItem(CACHE_TIMESTAMP_KEY);
        if (!timestamp) return false;
        const age = Date.now() - parseInt(timestamp);
        return age < (CACHE_TTL_MINUTES * 60 * 1000);
    } catch (e) {
        return false;
    }
}

// Get cached hierarchy
function getCachedHierarchy() {
    try {
        if (!isCacheValid()) return null;
        const cached = localStorage.getItem(CACHE_KEY);
        return cached ? JSON.parse(cached) : null;
    } catch (e) {
        return null;
    }
}

// Store hierarchy in cache
function cacheHierarchy(data) {
    try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(data));
        localStorage.setItem(CACHE_TIMESTAMP_KEY, Date.now().toString());
    } catch (e) {
        // Silently fail if localStorage is unavailable or full
        console.warn('Failed to cache hierarchy:', e);
    }
}

// Clear cached hierarchy (call this when hierarchy is modified)
function clearHierarchyCache() {
    try {
        localStorage.removeItem(CACHE_KEY);
        localStorage.removeItem(CACHE_TIMESTAMP_KEY);
        console.log('Hierarchy cache cleared');
    } catch (e) {
        console.warn('Failed to clear hierarchy cache:', e);
    }
    loadingTaxons.clear();
}

// ---------------------------------------------------------------------------
// Public API – called from simple.js
// ---------------------------------------------------------------------------

/**
 * Fetch taxon hierarchy from the backend and render it.
 * Uses localStorage cache for instant display on repeat visits.
 * Fetches fresh data in the background.
 */
async function loadHierarchy() {
    try {
        // Try to load from cache first for instant display
        const cachedData = getCachedHierarchy();
        if (cachedData) {
            taxonTree = cachedData.taxons || [];
            renderHierarchy(() => {
                // Restore open datasets panel from previous visit after rendering
                if (openSpeciesDataId) {
                    loadSpeciesDatasets(openSpeciesDataId);
                }
            });
        } else {
            // Show loading state if no cache
            document.getElementById('hierarchy-container').innerHTML = '<p style="color:#7f8c8d;">Ladataan…</p>';
        }
        
        // Fetch fresh data from server in the background
        const resp = await fetch('/api/taxons/tree');
        const data = await resp.json();
        taxonTree = data.taxons || [];
        
        // Cache the fresh data
        cacheHierarchy(data);
        
        // Only re-render if data changed (to avoid flickering)
        if (!cachedData || JSON.stringify(cachedData) !== JSON.stringify(data)) {
            renderHierarchy(() => {
                // Reload datasets if a panel was open and data changed
                if (openSpeciesDataId) {
                    loadSpeciesDatasets(openSpeciesDataId);
                }
            });
        }
        
    } catch (err) {
        console.error('Failed to load hierarchy:', err);
        
        // If we have cached data, show it as fallback
        const cachedData = getCachedHierarchy();
        if (cachedData && taxonTree.length > 0) {
            console.log('Showing cached data due to network error');
            // Data already rendered from cache
        } else {
            document.getElementById('hierarchy-container').innerHTML =
                '<p style="color:#c0392b;">Eliöryhmien lataus epäonnistui.</p>';
        }
    }
}

/**
 * Render (or re-render) the hierarchy into #hierarchy-container.
 * When a search is active, renders flat search results instead of the tree.
 * Debounced to prevent rapid successive renders.
 * @param {Function} onRenderComplete - Optional callback called after rendering completes
 */
function renderHierarchy(onRenderComplete) {
    if (renderHierarchyTimeout) clearTimeout(renderHierarchyTimeout);
    renderHierarchyTimeout = setTimeout(() => {
        const container = document.getElementById('hierarchy-container');
        if (!container) return;
        if (searchQuery.trim().length > 0) {
            renderSearchResults(searchQuery.trim());
        } else {
            const countEl = document.getElementById('search-result-count');
            if (countEl) countEl.textContent = '';
            container.innerHTML = buildNodes(taxonTree);
        }
        renderHierarchyTimeout = null;
        // Trigger lazy-loading for any expanded leaf nodes without projects
        ensureProjectsLoaded(taxonTree);
        // Call the callback after rendering is complete
        if (onRenderComplete && typeof onRenderComplete === 'function') {
            onRenderComplete();
        }
    }, 10);
}

/**
 * Walk the visible tree and start fetching projects for any expanded leaf
 * nodes that haven't been loaded yet.
 */
function ensureProjectsLoaded(nodes) {
    for (const node of nodes) {
        if (node.is_leaf && expandedTaxons.has(node.id) && node.projects === undefined) {
            loadTaxonProjects(node.id);
        }
        if (node.children && node.children.length > 0) {
            ensureProjectsLoaded(node.children);
        }
    }
}

/**
 * Fetch the species (projects) for a leaf taxon from the API and inject
 * them into the in-memory tree, then re-render.
 */
async function loadTaxonProjects(taxonId) {
    if (loadingTaxons.has(taxonId)) return;
    loadingTaxons.add(taxonId);
    try {
        const resp = await fetch(`/api/taxons/${taxonId}/children`);
        const data = await resp.json();
        const projects = data.projects || [];
        // Update the in-memory tree node with its projects
        updateTaxonNode(taxonTree, taxonId, { projects });
        renderHierarchy();
    } catch (err) {
        console.error(`Failed to load projects for taxon ${taxonId}:`, err);
    } finally {
        loadingTaxons.delete(taxonId);
    }
}

/** Update a single taxon node's properties in the in-memory tree. */
function updateTaxonNode(nodes, taxonId, props) {
    for (const node of nodes) {
        if (node.id === taxonId) {
            Object.assign(node, props);
            node._sortedProjects = null; // clear sort cache
            return true;
        }
        if (node.children && updateTaxonNode(node.children, taxonId, props)) return true;
    }
    return false;
}

// ---------------------------------------------------------------------------
// Build HTML
// ---------------------------------------------------------------------------

function buildNodes(nodes) {
    if (!nodes || nodes.length === 0) return '';

    const parts = [];
    for (const node of nodes) {
        const hasChildren = node.children && node.children.length > 0;
        const isLeaf = node.is_leaf;
        const isOpen = expandedTaxons.has(node.id);

        parts.push(`<div class="taxon-node" data-level="${node.level}" data-id="${node.id}">`);

        // Header row
        parts.push(`<div class="taxon-header ${isLeaf && !hasChildren ? 'leaf' : ''}" onclick="toggleTaxon(${node.id}, event)">`);

        // Caret / toggle icon
        if (isLeaf && !hasChildren) {
            parts.push(`<span class="taxon-toggle leaf">●</span>`);
        } else {
            parts.push(`<span class="taxon-toggle ${isOpen ? 'open' : ''}">${isOpen ? '▶' : '▶'}</span>`);
        }

        // Name
        parts.push(`<span class="taxon-name">${escapeHtml(node.name)}`);
        if (node.scientific_name) {
            parts.push(`<span class="taxon-scientific"> ${escapeHtml(node.scientific_name)}</span>`);
        }
        parts.push(`</span>`);

        // Badge: species count for leaves (shows ? until projects are loaded)
        if (isLeaf) {
            const count = node.projects !== undefined ? node.projects.length : '?';
            parts.push(`<span class="taxon-badge">${count} lajia</span>`);
            parts.push(`<button class="taxon-add-btn" onclick="openAddSpeciesModal(${node.id}, '${escapeAttr(node.name)}'); event.stopPropagation();">+ Lisää laji</button>`);
        }

        parts.push(`</div>`); // end header

        // Children container (sub-taxons)
        if (hasChildren) {
            parts.push(`<div class="taxon-children ${isOpen ? 'open' : ''}">`);
            parts.push(buildNodes(node.children));
            parts.push(`</div>`);
        }

        // Species list (for both leaf and non-leaf nodes)
        if (isOpen) {
            parts.push(buildSpeciesList(node));
        }

        parts.push(`</div>`); // end taxon-node
    }
    return parts.join('');
}

function buildSpeciesList(taxonNode) {
    // Show loading state while projects are being fetched from the server
    if (taxonNode.is_leaf && taxonNode.projects === undefined) {
        return `<div class="species-list"><p style="color:#7f8c8d; font-size:13px;">Ladataan lajeja…</p></div>`;
    }

    // Cache sorted species to avoid re-sorting on every render
    if (!taxonNode._sortedProjects) {
        taxonNode._sortedProjects = (taxonNode.projects || []).sort((a, b) => 
            (a.name || '').localeCompare(b.name || '', 'fi')
        );
    }
    const projects = taxonNode._sortedProjects;
    
    if (projects.length === 0) {
        return `<div class="species-list"><p style="color:#999; font-size:13px;">Ei lajeja vielä.</p></div>`;
    }

    const parts = ['<div class="species-list">'];
    for (const p of projects) {
        const isDataOpen = openSpeciesDataId === p.id;
        parts.push(`<div class="species-card" id="species-${p.id}"><div class="species-header-row" onclick="toggleSpeciesData(${p.id})"><span class="species-caret ${isDataOpen ? 'open' : ''}">▶</span><div class="species-info"><span class="species-name">${escapeHtml(p.name)}</span>${p.iucn_category ? `<span class="iucn-badge iucn-${iucnClass(p.iucn_category)}">${escapeHtml(p.iucn_category)}</span>` : ''}${p.description ? `<span class="species-desc">${escapeHtml(p.description)}</span>` : ''}</div><div class="species-actions"><select onchange="handleSpeciesAction(this, ${p.id})" onclick="event.stopPropagation()"><option value="" selected disabled>Työkalut ▾</option><option value="/stats">Näytä tilastot</option><option value="/grid">Laske esiintymisalue (AOO)</option><option value="/convex_hull">Laske levinneisyysalue (EOO)</option><option value="delete">Poista laji</option></select></div></div>${isDataOpen ? buildInlineDataPanel(p.id, p.name, p.mx_id) : ''}</div>`);
    }
    parts.push('</div>');
    return parts.join('');
}

function buildInlineDataPanel(speciesId, speciesName, mxId) {
    const defaultUrl = mxId ? `https://laji.fi/observation/list?target=${encodeURIComponent(mxId)}` : '';
    return `
    <div class="species-detail-panel open" id="data-panel-${speciesId}">
        <div id="datasets-${speciesId}">Ladataan…</div>

        <h4 style="margin-top:16px;">Hae aineistoa</h4>
        <div class="input-group">
            <label>Liitä Laji.fi-rajausten URL:
                <span class="info-tooltip" data-tip="Avaa laji.fi-sivusto ja rajaa havainnot haluamallasi tavalla (esim. laji, alue, vuosi). Kopioi selaimen osoitepalkin URL ja liitä se tähän kenttään. Sovellus hakee rajaukseesi sopivat havainnot automaattisesti.">i</span>
            </label>
            <div class="input-row">
                <input type="text" id="url-${speciesId}" placeholder="https://laji.fi/observation/list?..." value="${escapeAttr(defaultUrl)}">
                <button onclick="fetchDataForSpecies(${speciesId})" class="btn-fetch">Hae tiedot</button>
            </div>
            ${defaultUrl ? `<p style="margin:4px 0 0; font-size:12px; color:#856404; background:#fff3cd; border:1px solid #ffc107; border-radius:4px; padding:4px 8px;">Yllä oleva oletus-URL sisältää havainnot ilman suodattimia. Voit lisätä rajauksia laji.fi-sivustolla ja sitten kopioida URL:n ylle.</p>` : ''}
        </div>

        <div style="margin-top:12px; padding:8px; background:#fafafa; border-radius:4px;">
            <div class="input-group">
                <label>Tai lataa CSV (lat &amp; lon tai WKT):
                    <span class="info-tooltip" data-tip="Lataa oma havaintoaineisto CSV-tiedostona. Tiedostossa tulee olla joko 'lat' ja 'lon' sarakkeet (desimaaliasteet, WGS84) tai 'wkt' sarake WKT-muotoisilla geometrioilla (pisteet, viivat tai alueet) WGS84-koordinaattijärjestelmässä. Huom! Kaikki ominaisuudet (esim. tilastot) eivät ota huomioon custom-aineistoja, ellei sarakkeiden nimet ole täsmälleen samoja, kuin laji.fi:stä ladattavassa datassa.">i</span>
                </label>
                <div class="input-row">
                    <input type="file" id="file-${speciesId}" accept=".csv">
                    <button onclick="uploadCsvForSpecies(${speciesId})" class="btn-small">Lataa CSV</button>
                </div>
            </div>
        </div>

        <div id="fetch-progress-${speciesId}" class="fetch-progress" style="display:none;">
            <h4>Edistyminen:</h4>
            <div id="progress-log-${speciesId}"></div>
        </div>

        <div id="save-section-${speciesId}" style="display:none; margin-top:15px;">
            <button onclick="saveDataForSpecies(${speciesId})" class="btn-save">Tallenna</button>
        </div>
    </div>`;
}

// ---------------------------------------------------------------------------
// Interactions
// ---------------------------------------------------------------------------

function toggleTaxon(id, event) {
    // Don't toggle if clicked on a button inside the header
    if (event && event.target.closest('.taxon-add-btn')) return;

    if (expandedTaxons.has(id)) {
        expandedTaxons.delete(id);
    } else {
        expandedTaxons.add(id);
    }
    try { localStorage.setItem('expandedTaxons', JSON.stringify([...expandedTaxons])); } catch (e) { /* ignore */ }
    renderHierarchy();
}

// Track which species has its data panel open (only one at a time)
let openSpeciesDataId = (() => {
    try {
        const v = localStorage.getItem('openSpeciesDataId');
        return v ? Number(v) : null;
    } catch (e) { return null; }
})();

function toggleSpeciesData(speciesId) {
    if (openSpeciesDataId === speciesId) {
        openSpeciesDataId = null;
    } else {
        openSpeciesDataId = speciesId;
    }
    try { localStorage.setItem('openSpeciesDataId', openSpeciesDataId ?? ''); } catch (e) { /* ignore */ }
    
    // Render hierarchy and load datasets after rendering if panel is now open
    renderHierarchy(() => {
        if (openSpeciesDataId === speciesId) {
            loadSpeciesDatasets(speciesId);
        }
    });
}

function handleSpeciesAction(selectElem, projectId) {
    const v = selectElem.value;
    if (!v) return;
    selectElem.selectedIndex = 0;

    if (v === 'delete') {
        deleteSpecies(projectId);
    } else {
        window.location.href = `${v}?id=${encodeURIComponent(projectId)}`;
    }
}

// ---------------------------------------------------------------------------
// Modal: Add Species
// ---------------------------------------------------------------------------

let currentModalTaxonId = null;

function openAddSpeciesModal(taxonId, taxonName) {
    currentModalTaxonId = taxonId;
    const overlay = document.getElementById('add-species-modal');
    const subtitle = document.getElementById('modal-taxon-name');
    const nameInput = document.getElementById('modal-species-name');
    const descInput = document.getElementById('modal-species-desc');

    if (subtitle) subtitle.textContent = taxonName;
    nameInput.value = '';
    descInput.value = '';
    overlay.classList.add('visible');
    setTimeout(() => nameInput.focus(), 50);
}

function closeAddSpeciesModal() {
    const overlay = document.getElementById('add-species-modal');
    overlay.classList.remove('visible');
    currentModalTaxonId = null;
}

async function submitAddSpecies() {
    const name = document.getElementById('modal-species-name').value.trim();
    const description = document.getElementById('modal-species-desc').value.trim();

    if (!name) {
        showError('Lajin nimi on pakollinen');
        return;
    }
    if (!currentModalTaxonId) return;

    try {
        const resp = await fetch('/api/species', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name,
                description,
                taxon_id: currentModalTaxonId
            })
        });
        const result = await resp.json();
        if (result.success) {
            showSuccess('Laji lisätty onnistuneesti!');
            closeAddSpeciesModal();
            // Clear cache since hierarchy has changed
            clearHierarchyCache();
            // Make sure this taxon is expanded so the new species is visible
            expandedTaxons.add(currentModalTaxonId);
            await loadHierarchy();
        } else {
            showError('Lajin lisääminen epäonnistui: ' + result.error);
        }
    } catch (err) {
        console.error('Error creating species:', err);
        showError('Lajin lisääminen epäonnistui');
    }
}

// ---------------------------------------------------------------------------
// Delete species
// ---------------------------------------------------------------------------

async function deleteSpecies(projectId) {
    if (!confirm('Haluatko varmasti poistaa tämän lajin? Kaikki aineistot poistetaan pysyvästi.')) return;

    try {
        const resp = await fetch(`/api/species/${projectId}`, { method: 'DELETE' });
        const result = await resp.json();
        if (result.success) {
            showSuccess('Laji poistettu onnistuneesti!');
            // Clear cache since hierarchy has changed
            clearHierarchyCache();
            await loadHierarchy();
        } else {
            showError('Lajin poistaminen epäonnistui: ' + result.error);
        }
    } catch (err) {
        console.error('Error deleting species:', err);
        showError('Lajin poistaminen epäonnistui');
    }
}



// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

/**
 * Called by the search button or Enter key.
 */
function doHierarchySearch() {
    const input = document.getElementById('hierarchy-search');
    searchQuery = input ? input.value : '';
    // Clear memoized results when search changes
    searchMemoCache = {};
    renderHierarchy();
}

/**
 * Render flat search results for `query`.
 */
function renderSearchResults(query) {
    const container = document.getElementById('hierarchy-container');
    const countEl = document.getElementById('search-result-count');
    if (!container) return;

    const speciesMatches = [];
    const groupMatches = [];
    collectMatches(taxonTree, query.toLowerCase(), [], speciesMatches, groupMatches);

    const total = speciesMatches.length + groupMatches.length;
    if (countEl) countEl.textContent = total > 0 ? `${total} osumaa` : '';

    if (total === 0) {
        container.innerHTML = `<div class="search-no-results">Ei hakutuloksia haulle "${escapeHtml(query)}"</div>`;
        return;
    }

    let html = '<div class="search-results">';

    // --- Taxon group matches ---
    for (const { node, breadcrumb } of groupMatches) {
        const path = breadcrumb.length ? breadcrumb.join(' › ') : '';
        html += `
        <div class="search-result-item">
            ${path ? `<div class="result-breadcrumb">${escapeHtml(path)}</div>` : ''}
            <div class="result-name">📁 ${highlightMatch(node.name, query)}${node.scientific_name ? ` <span style="font-weight:400;font-style:italic;font-size:13px;color:#7f8c8d;">${highlightMatch(node.scientific_name, query)}</span>` : ''}</div>
            <div class="result-meta">${node.is_leaf ? 'Lehtiryhmä' : 'Ryhmä'}</div>
            <div class="result-actions">
                <button class="btn-small" onclick="navigateToTaxon(${node.id})">Avaa ryhmässä</button>
            </div>
        </div>`;
    }

    // --- Species matches ---
    for (const { p, breadcrumb, taxonId } of speciesMatches) {
        const path = breadcrumb.join(' › ');
        const isDataOpen = openSpeciesDataId === p.id;
        html += `
        <div class="search-result-item" id="species-${p.id}">
            <div class="result-header-row" onclick="toggleSpeciesDataInSearch(${p.id}, ${taxonId})">
                <span class="species-caret ${isDataOpen ? 'open' : ''}">▶</span>
                <div style="flex:1; min-width:0;">
                    <div class="result-breadcrumb">${escapeHtml(path)}</div>
                    <div class="result-name">
                        ${highlightMatch(p.name, query)}
                        ${p.iucn_category ? `<span class="iucn-badge iucn-${iucnClass(p.iucn_category)}" style="margin-left:6px;">${escapeHtml(p.iucn_category)}</span>` : ''}
                    </div>
                    ${p.description ? `<div class="result-meta">${highlightMatch(p.description, query)}</div>` : ''}
                </div>
                <div class="species-actions">
                    <select onchange="handleSpeciesAction(this, ${p.id})" onclick="event.stopPropagation()">
                        <option value="" selected disabled>Työkalut ▾</option>
                        <option value="/stats">Näytä tilastot</option>
                        <option value="/grid">Laske esiintymisalue (AOO)</option>
                        <option value="/convex_hull">Laske levinneisyysalue (EOO)</option>
                        <option value="delete">Poista laji</option>
                    </select>
                    <button class="btn-small" onclick="navigateToTaxon(${taxonId}); event.stopPropagation()">Näytä ryhmässä</button>
                </div>
            </div>
            ${isDataOpen ? buildInlineDataPanel(p.id, p.name, p.mx_id) : ''}
        </div>`;
    }

    html += '</div>';
    container.innerHTML = html;

    // Load datasets if any data panel is open
    if (openSpeciesDataId) {
        loadSpeciesDatasets(openSpeciesDataId);
    }
}

/**
 * Recursively collect taxon-group and species matches.
 * Results are memoized per query to avoid re-traversing the tree.
 */
function collectMatches(nodes, queryLower, breadcrumb, speciesMatches, groupMatches) {
    for (const node of nodes) {
        const nodeNameLower = (node.name || '').toLowerCase();
        const nodeSciLower = (node.scientific_name || '').toLowerCase();

        // Check if this taxon group itself matches
        if (nodeNameLower.includes(queryLower) || nodeSciLower.includes(queryLower)) {
            groupMatches.push({ node, breadcrumb: [...breadcrumb] });
        }

        // Check species (projects) at this node
        if (node.projects) {
            for (const p of node.projects) {
                const speciesNameLower = (p.name || '').toLowerCase();
                const descLower = (p.description || '').toLowerCase();
                if (speciesNameLower.includes(queryLower) || descLower.includes(queryLower)) {
                    speciesMatches.push({
                        p,
                        breadcrumb: [...breadcrumb, node.name],
                        taxonId: node.id
                    });
                }
            }
        }

        // Recurse into children
        if (node.children && node.children.length > 0) {
            collectMatches(node.children, queryLower, [...breadcrumb, node.name], speciesMatches, groupMatches);
        }
    }
}

/**
 * Highlight all occurrences of `query` in `text` using <mark>.
 */
function highlightMatch(text, query) {
    if (!text || !query) return escapeHtml(text);
    const escaped = escapeHtml(text);
    const escapedQuery = escapeHtml(query).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return escaped.replace(new RegExp(`(${escapedQuery})`, 'gi'), '<mark>$1</mark>');
}

/**
 * Navigate to a taxon in the tree: expand it, clear search, scroll to it.
 */
function navigateToTaxon(taxonId) {
    // Expand all ancestors up to this taxon, then expand the taxon itself
    function expandPath(nodes, targetId) {
        for (const n of nodes) {
            if (n.id === targetId) {
                expandedTaxons.add(n.id);
                return true;
            }
            if (n.children && expandPath(n.children, targetId)) {
                expandedTaxons.add(n.id);
                return true;
            }
        }
        return false;
    }
    expandPath(taxonTree, taxonId);
    try { localStorage.setItem('expandedTaxons', JSON.stringify([...expandedTaxons])); } catch (e) { /* ignore */ }

    // Clear search and re-render tree
    searchQuery = '';
    const input = document.getElementById('hierarchy-search');
    if (input) input.value = '';
    const countEl = document.getElementById('search-result-count');
    if (countEl) countEl.textContent = '';
    renderHierarchy();

    // Scroll to the node
    setTimeout(() => {
        const el = document.querySelector(`.taxon-node[data-id="${taxonId}"]`);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
}

/**
 * Toggle data panel for a species while in search results view.
 */
function toggleSpeciesDataInSearch(speciesId, taxonId) {
    if (openSpeciesDataId === speciesId) {
        openSpeciesDataId = null;
    } else {
        openSpeciesDataId = speciesId;
    }
    try { localStorage.setItem('openSpeciesDataId', openSpeciesDataId ?? ''); } catch (e) { /* ignore */ }
    // Re-render search results
    renderSearchResults(searchQuery.trim());
    if (openSpeciesDataId === speciesId) {
        loadSpeciesDatasets(speciesId);
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Derive a short CSS class from an IUCN category string.
 * E.g. "LC – Elinvoimaiset" → "LC", "CR – Äärimmäisen uhanalaiset" → "CR"
 */
function iucnClass(category) {
    if (!category) return '';
    const code = category.trim().split(/[\s–-]/)[0].toUpperCase();
    return ['LC','NT','VU','EN','CR','EW','EX','DD','NA','NE'].includes(code) ? code : '';
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function escapeAttr(text) {
    if (!text) return '';
    return text.replace(/'/g, "\\'").replace(/"/g, '&quot;');
}

// Helper to find a taxon node by id in the tree (recursive)
function findTaxonById(nodes, id) {
    for (const n of nodes) {
        if (n.id === id) return n;
        if (n.children) {
            const found = findTaxonById(n.children, id);
            if (found) return found;
        }
    }
    return null;
}
