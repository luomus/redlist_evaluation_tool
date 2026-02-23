/**
 * hierarchy.js – Accordion-based taxon hierarchy browser.
 *
 * Renders the taxon tree fetched from /api/taxons?projects=1 as a
 * collapsible accordion on the main page.  Leaf nodes show their
 * species (projects) and an "+ Lisää laji" button that opens a modal.
 */

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let taxonTree = [];          // full tree from API
let expandedTaxons = new Set(); // ids of currently expanded taxons

// ---------------------------------------------------------------------------
// Public API – called from simple.js
// ---------------------------------------------------------------------------

/**
 * Fetch taxon hierarchy from the backend and render it.
 */
async function loadHierarchy() {
    try {
        const resp = await fetch('/api/taxons?projects=1');
        const data = await resp.json();
        taxonTree = data.taxons || [];
        renderHierarchy();
    } catch (err) {
        console.error('Failed to load hierarchy:', err);
        document.getElementById('hierarchy-container').innerHTML =
            '<p style="color:#c0392b;">Eliöryhmien lataus epäonnistui.</p>';
    }
}

/**
 * Render (or re-render) the hierarchy into #hierarchy-container.
 */
function renderHierarchy() {
    const container = document.getElementById('hierarchy-container');
    if (!container) return;
    container.innerHTML = buildNodes(taxonTree);
}

// ---------------------------------------------------------------------------
// Build HTML
// ---------------------------------------------------------------------------

function buildNodes(nodes) {
    if (!nodes || nodes.length === 0) return '';

    let html = '';
    for (const node of nodes) {
        const hasChildren = node.children && node.children.length > 0;
        const isLeaf = node.is_leaf;
        const isOpen = expandedTaxons.has(node.id);

        html += `<div class="taxon-node" data-level="${node.level}" data-id="${node.id}">`;

        // Header row
        html += `<div class="taxon-header ${isLeaf && !hasChildren ? 'leaf' : ''}" onclick="toggleTaxon(${node.id}, event)">`;

        // Caret / toggle icon
        if (isLeaf && !hasChildren) {
            html += `<span class="taxon-toggle leaf">●</span>`;
        } else {
            html += `<span class="taxon-toggle ${isOpen ? 'open' : ''}">${isOpen ? '▶' : '▶'}</span>`;
        }

        // Name
        html += `<span class="taxon-name">${escapeHtml(node.name)}`;
        if (node.scientific_name) {
            html += `<span class="taxon-scientific"> ${escapeHtml(node.scientific_name)}</span>`;
        }
        html += `</span>`;

        // Badge: species count for leaves
        if (isLeaf) {
            const count = (node.projects || []).length;
            html += `<span class="taxon-badge">${count} lajia</span>`;
            html += `<button class="taxon-add-btn" onclick="openAddSpeciesModal(${node.id}, '${escapeAttr(node.name)}'); event.stopPropagation();">+ Lisää laji</button>`;
        }

        html += `</div>`; // end header

        // Children container (sub-taxons)
        if (hasChildren) {
            html += `<div class="taxon-children ${isOpen ? 'open' : ''}">`;
            html += buildNodes(node.children);
            html += `</div>`;
        }

        // Species list for leaf nodes
        if (isLeaf && isOpen) {
            html += buildSpeciesList(node);
        }

        html += `</div>`; // end taxon-node
    }
    return html;
}

function buildSpeciesList(taxonNode) {
    const projects = taxonNode.projects || [];
    if (projects.length === 0) {
        return `<div class="species-list"><p style="color:#999; font-size:13px;">Ei lajeja vielä.</p></div>`;
    }

    let html = '<div class="species-list">';
    for (const p of projects) {
        const isDataOpen = openSpeciesDataId === p.id;
        html += `
        <div class="species-card" id="species-${p.id}">
            <div class="species-header-row">
                <div class="species-info">
                    <span class="species-name">${escapeHtml(p.name)}</span>
                    ${p.description ? `<span class="species-desc">${escapeHtml(p.description)}</span>` : ''}
                </div>
                <div class="species-actions">
                    <button class="btn-small btn-primary" onclick="toggleSpeciesData(${p.id}); event.stopPropagation();">${isDataOpen ? '▼ Piilota aineistot' : '▶ Näytä aineistot'}</button>
                    <select onchange="handleSpeciesAction(this, ${p.id})">
                        <option value="" selected disabled>Työkalut ▾</option>
                        <option value="/stats">Näytä tilastot</option>
                        <option value="/grid">Laske esiintymisalue (AOO)</option>
                        <option value="/convex_hull">Laske levinneisyysalue (EOO)</option>
                        <option value="delete">Poista laji</option>
                    </select>
                </div>
            </div>
            ${isDataOpen ? buildInlineDataPanel(p.id, p.name) : ''}
        </div>`;
    }
    html += '</div>';
    return html;
}

function buildInlineDataPanel(speciesId, speciesName) {
    return `
    <div class="species-detail-panel open" id="data-panel-${speciesId}">
        <h4>Aineistot: ${escapeHtml(speciesName)}</h4>
        <div id="datasets-${speciesId}">Ladataan…</div>

        <h4 style="margin-top:16px;">Hae aineistoa</h4>
        <div class="input-group">
            <label>Liitä Laji.fi-rajausten URL:</label>
            <input type="text" id="url-${speciesId}" placeholder="https://laji.fi/observation/list?...">
        </div>
        <button onclick="fetchDataForSpecies(${speciesId})" class="btn-fetch">Hae tiedot</button>

        <div style="margin-top:12px; padding:8px; background:#fafafa; border-radius:4px;">
            <div class="input-group">
                <label>Tai lataa CSV (lat &amp; lon tai WKT):</label>
                <input type="file" id="file-${speciesId}" accept=".csv">
            </div>
            <button onclick="uploadCsvForSpecies(${speciesId})" class="btn-small">Lataa CSV</button>
        </div>

        <div id="fetch-progress-${speciesId}" class="fetch-progress" style="display:none;">
            <h4>Edistyminen:</h4>
            <div id="progress-log-${speciesId}"></div>
        </div>

        <div id="save-section-${speciesId}" style="display:none; margin-top:15px;">
            <div class="input-group">
                <label>Aineiston nimi (valinnainen):</label>
                <input type="text" id="dataset-name-${speciesId}" maxlength="256">
            </div>
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
    renderHierarchy();
}

// Track which species has its data panel open (only one at a time)
let openSpeciesDataId = null;

function toggleSpeciesData(speciesId) {
    if (openSpeciesDataId === speciesId) {
        openSpeciesDataId = null;
    } else {
        openSpeciesDataId = speciesId;
    }
    renderHierarchy();
    // After render, load datasets if panel is now open
    if (openSpeciesDataId === speciesId) {
        loadSpeciesDatasets(speciesId);
    }
}

function handleSpeciesAction(selectElem, projectId) {
    const v = selectElem.value;
    if (!v) return;
    selectElem.selectedIndex = 0;

    if (v === 'delete') {
        deleteSpecies(projectId);
    } else {
        window.open(`${v}?id=${encodeURIComponent(projectId)}`, '_blank');
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
// Helpers
// ---------------------------------------------------------------------------

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
