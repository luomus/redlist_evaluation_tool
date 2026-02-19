// App state
let currentProject = null;

// Initialize app on load
document.addEventListener('DOMContentLoaded', function() {
    loadUserInfo();
    loadProjects();

    // Wire up search input and clear button
    const searchInput = document.getElementById('projectSearch');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => filterProjects(e.target.value));
        const clearBtn = document.getElementById('clearSearch');
        if (clearBtn) {
            clearBtn.addEventListener('click', () => { searchInput.value = ''; filterProjects(''); searchInput.focus(); });
        }
    }
});

// Load and display user information
async function loadUserInfo() {
    try {
        const response = await fetch('/api/user');
        if (response.ok) {
            const data = await response.json();
            const userInfoDiv = document.getElementById('userInfo');
            if (userInfoDiv) {
                let userInfoHTML = '';
                if (data.user_name) {
                    userInfoHTML += `<strong>👤 ${data.user_name}</strong>`;
                }
                if (data.user_email) {
                    userInfoHTML += `<br><small>${data.user_email}</small>`;
                }
                if (data.user_id) {
                    userInfoHTML += `<br><small>${data.user_id}</small>`;
                }
                userInfoDiv.innerHTML = userInfoHTML || 'User info not available';
            }
        }
    } catch (error) {
        console.error('Failed to load user info:', error);
    }
}

// Generate unique ID
function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

// Show success message
function showSuccess(message) {
    const errorDiv = document.getElementById('error');
    errorDiv.textContent = message;
    errorDiv.style.color = '#155724';
    errorDiv.style.backgroundColor = '#d4edda';
    errorDiv.style.border = '1px solid #c3e6cb';
    errorDiv.style.display = 'block';
    setTimeout(() => {
        errorDiv.style.display = 'none';
    }, 3000);
}

function showError(message) {
    const errorDiv = document.getElementById('error');
    errorDiv.textContent = message;
    errorDiv.style.color = '#721c24';
    errorDiv.style.backgroundColor = '#f8d7da';
    errorDiv.style.border = '1px solid #f5c6cb';
    errorDiv.style.display = 'block';
}

// Update project description
async function updateProjectDescription(projectId) {
    const description = document.getElementById(`edit-description-${projectId}`).value.trim();
    
    try {
        const response = await fetch(`/api/projects/${projectId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ description })
        });
        
        const result = await response.json();
        if (result.success) {
            showSuccess('Kuvaus päivitetty onnistuneesti!');
            loadProjects();
        } else {
            showError('Kuvauksen päivittäminen epäonnistui: ' + result.error);
        }
    } catch (error) {
        console.error('Error updating description:', error);
        showError('Kuvauksen päivittäminen epäonnistui');
    }
}

// Toggle edit description form
function toggleEditDescription(projectId) {
    const editDiv = document.getElementById(`edit-desc-${projectId}`);
    if (editDiv.style.display === 'none') {
        editDiv.style.display = 'block';
    } else {
        editDiv.style.display = 'none';
    }
}

// Load all projects
async function loadProjects() {
    try {
        const response = await fetch('/api/projects');
        const result = await response.json();
        displayProjects(result.projects || []);
    } catch (error) {
        console.error('Error loading projects:', error);
    }
}

// Display projects
function displayProjects(projects) {
    const projectsDiv = document.getElementById('projects');
    const projectsList = document.getElementById('projectsList');
    
    // Save state of expanded details sections and parent children before re-rendering
    const expandedDetails = new Set();
    const expandedParents = new Set();
    
    document.querySelectorAll('.project-details[style*="display: block"]').forEach(details => {
        const projectId = details.id.replace('details-', '');
        expandedDetails.add(projectId);
    });
    
    document.querySelectorAll('.child-projects[style*="display: block"]').forEach(children => {
        const projectId = children.id.replace('children-', '');
        expandedParents.add(projectId);
    });
    
    if (projects.length === 0) {
        projectsList.innerHTML = '<p>Ei vielä eliöryhmiä. Luo uusi ylhäältä.</p>';
        projectsDiv.style.display = 'block';
        return;
    }
    
    let html = '<div class="project-list">';
    projects.forEach(project => {
        html += `
            <div class="project-item parent-project" id="project-${project.id}" data-project-name="${escapeHtml(project.name).toLowerCase()}">
                <div class="project-header">
                    <h3 class="${project.child_count > 0 ? 'clickable' : ''}" ${project.child_count > 0 ? `onclick="toggleChildren(${project.id})" role="button" aria-expanded="false" tabindex="0" onkeydown="if(event.key==='Enter'||event.key===' '){ toggleChildren(${project.id}); event.preventDefault(); }"` : ''}>
                        <span class="toggle-children ${project.child_count > 0 ? '' : 'disabled'}">${project.child_count > 0 ? '▶' : '○'}</span>
                        ${escapeHtml(project.name)}
                        <span class="child-count">(${project.child_count} lajia)</span>
                    </h3>
                    <div class="project-actions">
                        <button onclick="showAddChildForm(${project.id})" class="btn-small btn-primary">+ Lisää laji</button>
                        <button onclick="toggleEditDescription(${project.id})" class="btn-small">Muokkaa kuvausta</button>
                        <button onclick="deleteProject(${project.id})" class="btn-small btn-danger">Poista</button>
                    </div>
                </div>
                ${project.description ? `<p class="project-description">${escapeHtml(project.description)}</p>` : '<p class="project-description" style="color: #999;">Ei kuvausta</p>'}
                
                <!-- Edit Description Section -->
                <div id="edit-desc-${project.id}" style="display: none; margin: 10px 0; padding: 10px; background: #f8f9fa; border-radius: 4px;">
                    <div class="input-group">
                        <label>Kuvaus:</label>
                        <textarea id="edit-description-${project.id}" style="width: 100%; min-height: 80px;">${escapeHtml(project.description || '')}</textarea>
                    </div>
                    <button onclick="updateProjectDescription(${project.id})" class="btn-small">Tallenna kuvaus</button>
                    <button onclick="toggleEditDescription(${project.id})" class="btn-small">Peruuta</button>
                </div>
                
                <!-- Add Child Project Form -->
                <div id="add-child-${project.id}" style="display: none; margin: 10px 0; padding: 10px; background: #e8f4f8; border-radius: 4px;">
                    <h4>Lisää uusi laji</h4>
                    <div class="input-group">
                        <label>Lajin nimi:</label>
                        <input type="text" id="child-name-${project.id}" placeholder="Anna lajin nimi">
                    </div>
                    <div class="input-group">
                        <label>Kuvaus (valinnainen):</label>
                        <textarea id="child-description-${project.id}" style="width: 100%; min-height: 60px;"></textarea>
                    </div>
                    <button onclick="createChildProject(${project.id})" class="btn-small">Luo laji</button>
                    <button onclick="hideAddChildForm(${project.id})" class="btn-small">Peruuta</button>
                </div>
                
                <div class="project-stats">
                    <span><strong>Aineistojen määrä:</strong> ${project.dataset_count}</span>
                    <span><strong>Havaintojen määrä:</strong> ${project.observation_count}</span>
                    <span><strong>Luotu:</strong> ${new Date(project.created_at).toLocaleDateString()}</span>
                </div>
                
                <!-- Child Projects -->
                <div id="children-${project.id}" class="child-projects" style="display: none;">
                    ${project.children && project.children.length > 0 ? displayChildProjects(project.children) : '<p style="padding: 10px; color: #999;">Ei lajeja vielä.</p>'}
                </div>
            </div>
        `;
    });
    html += '</div>';
    
    projectsList.innerHTML = html;
    projectsDiv.style.display = 'block';
    
    // Restore expanded parent children sections after re-rendering
    expandedParents.forEach(projectId => {
        const childrenDiv = document.getElementById(`children-${projectId}`);
        const toggle = document.querySelector(`#project-${projectId} .toggle-children`);
        const projectItem = document.getElementById(`project-${projectId}`);
        const header = projectItem?.querySelector('h3.clickable');
        
        if (childrenDiv && toggle && projectItem) {
            childrenDiv.style.display = 'block';
            toggle.textContent = '▼';
            projectItem.classList.add('open');
            if (header) header.setAttribute('aria-expanded','true');
        }
    });
    
    // Restore expanded details sections after re-rendering
    expandedDetails.forEach(projectId => {
        const detailsDiv = document.getElementById(`details-${projectId}`);
        const btn = document.querySelector(`#child-project-${projectId} .toggle-details-btn`);
        if (detailsDiv && btn) {
            detailsDiv.style.display = 'block';
            btn.setAttribute('aria-expanded','true');
            const c = btn.querySelector('.caret'); if (c) c.textContent = '▼';
            const l = btn.querySelector('.btn-label'); if (l) l.textContent = 'Piilota aineistot';
        }
    });
}

// Display child projects
function displayChildProjects(children) {
    let html = '';
    children.forEach(child => {
        html += `
            <div class="child-project-item" id="child-project-${child.id}" data-project-name="${escapeHtml(child.name).toLowerCase()}">
                <div class="project-header">
                    <h4>${escapeHtml(child.name)}</h4>
                    <div class="project-actions">
                        <button class="btn-small btn-primary toggle-details-btn" onclick="toggleProjectDetails(${child.id})" aria-expanded="false"><span class="caret">▶</span> <span class="btn-label">Näytä aineistot</span></button>
                        <select class="tool-select" onchange="handleActionSelect(this, ${child.id})">
                            <option value="" selected disabled>Toiminnot ▾</option>
                            <option value="/stats">Näytä tilastot</option>
                            <option value="/map">Näytä/muokkaa kartalla</option>
                            <option value="/grid">Laske esiintymisalue (AOO)</option>
                            <option value="/convex_hull">Laske levinneisyysalue (EOO)</option>
                            <option value="edit">Muokkaa kuvausta</option>
                            <option value="delete">Poista laji</option>
                        </select>
                    </div>
                </div>
                ${child.description ? `<p class="project-description">${escapeHtml(child.description)}</p>` : '<p class="project-description" style="color: #999; font-size: 0.9em;">Ei kuvausta</p>'}
                
                <!-- Edit Description Section -->
                <div id="edit-desc-${child.id}" style="display: none; margin: 10px 0; padding: 10px; background: #f8f9fa; border-radius: 4px;">
                    <div class="input-group">
                        <label>Kuvaus:</label>
                        <textarea id="edit-description-${child.id}" style="width: 100%; min-height: 60px;">${escapeHtml(child.description || '')}</textarea>
                    </div>
                    <button onclick="updateProjectDescription(${child.id})" class="btn-small">Tallenna kuvaus</button>
                    <button onclick="toggleEditDescription(${child.id})" class="btn-small">Peruuta</button>
                </div>
                
                <div class="project-stats">
                    <span><strong>Aineistot:</strong> ${child.dataset_count}</span>
                    <span><strong>Havaintoja:</strong> ${child.observation_count}</span>
                </div>
                
                <div class="project-details" id="details-${child.id}" style="display: none;">
                    <!-- Datasets list -->
                    <div class="datasets-section">
                        <h4>Lajin aineistot</h4>
                        <div id="datasets-${child.id}">Ladataan…</div>
                    </div>

                    <!-- Add data section -->
                    <div class="add-data-section">
                        <h4>Lisää lajin aineistot</h4>
                        <div class="input-group">
                            <label>Liitä tähän Laji.fi-rajausten URL:</label>
                            <input type="text" id="url-${child.id}" placeholder="https://laji.fi/observation/list?time=-1%2F0">
                        </div>
                        <button onclick="fetchDataForProject(${child.id})" class="btn-fetch">Hae tiedot</button>

                        <!-- Upload CSV from computer -->
                        <div style="margin-top:12px; padding:8px; background:#fafafa; border-radius:4px;">
                            <div class="input-group">
                                <label>Tai lataa CSV-tiedosto tietokoneelta (vaatii lat & lon -sarakkeet tai WKT-geometriakentän, esim. "wkt"):</label>
                                <input type="file" id="file-${child.id}" accept=".csv">
                            </div>
                            <button onclick="uploadCsvToProject(${child.id})" class="btn-small">Lataa CSV</button>
                            <div id="upload-progress-${child.id}" style="display:none; margin-top:8px; color:#555;"></div>
                        </div>
                        
                        <div id="fetch-progress-${child.id}" class="fetch-progress" style="display: none;">
                            <h4>Edistyminen:</h4>
                            <div id="progress-log-${child.id}"></div>
                        </div>
                        
                        <div id="save-section-${child.id}" style="display: none; margin-top: 15px;">
                            <div class="input-group">
                                <label>Aineiston nimi (valinnainen):</label>
                                <input type="text" id="dataset-name-${child.id}" maxlength="256">
                            </div>
                            <button onclick="saveDataToProject(${child.id})" class="btn-save">Tallenna lajiin</button>
                        </div>
                    </div>
                </div> 
            </div>
        `;
    });
    return html;
}

// Filter projects by name and description (case-insensitive)
function filterProjects(query) {
    const q = (query || '').trim().toLowerCase();
    document.querySelectorAll('.project-item').forEach(item => {
        const name = item.getAttribute('data-project-name') || '';
        const desc = (item.querySelector('.project-description')?.textContent || item.querySelector('.project-description-preview')?.textContent || '').toLowerCase();
        if (!q || name.includes(q) || desc.includes(q)) {
            item.style.display = '';
        } else {
            item.style.display = 'none';
        }
    });
}

// Toggle children visibility
function toggleChildren(parentId) {
    const childrenDiv = document.getElementById(`children-${parentId}`);
    const toggle = document.querySelector(`#project-${parentId} .toggle-children`);
    const projectItem = document.getElementById(`project-${parentId}`);
    const header = projectItem?.querySelector('h3.clickable');

    // If no children container, nothing to toggle
    if (!childrenDiv) return;

    const isHidden = childrenDiv.style.display === 'none' || childrenDiv.style.display === '';

    if (isHidden) {
        childrenDiv.style.display = 'block';
        if (toggle) toggle.textContent = '▼';
        projectItem?.classList.add('open');
        if (header) header.setAttribute('aria-expanded','true');
    } else {
        childrenDiv.style.display = 'none';
        if (toggle) toggle.textContent = '▶';
        projectItem?.classList.remove('open');
        if (header) header.setAttribute('aria-expanded','false');
    }
} 

// Show add child form
function showAddChildForm(parentId) {
    const form = document.getElementById(`add-child-${parentId}`);
    form.style.display = 'block';
    document.getElementById(`child-name-${parentId}`).focus();
}

// Hide add child form
function hideAddChildForm(parentId) {
    const form = document.getElementById(`add-child-${parentId}`);
    form.style.display = 'none';
    document.getElementById(`child-name-${parentId}`).value = '';
    document.getElementById(`child-description-${parentId}`).value = '';
}

// Create child project
async function createChildProject(parentId) {
    const name = document.getElementById(`child-name-${parentId}`).value.trim();
    const description = document.getElementById(`child-description-${parentId}`).value.trim();
    
    if (!name) {
        showError('Lajin nimi on pakollinen');
        return;
    }
    
    try {
        const response = await fetch(`/api/projects/${parentId}/children`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, description })
        });
        
        const result = await response.json();
        if (result.success) {
            showSuccess('Laji luotu onnistuneesti!');
            hideAddChildForm(parentId);
            await loadProjects();
            // Auto-expand the parent to show the new child
            setTimeout(() => {
                const childrenDiv = document.getElementById(`children-${parentId}`);
                const toggle = document.querySelector(`#project-${parentId} .toggle-children`);
                const projectItem = document.getElementById(`project-${parentId}`);
                const header = projectItem?.querySelector('h3.clickable');
                if (childrenDiv && toggle && projectItem) {
                    childrenDiv.style.display = 'block';
                    toggle.textContent = '▼';
                    projectItem.classList.add('open');
                    if (header) header.setAttribute('aria-expanded','true');
                }
            }, 100);
        } else {
            showError('Lajin luominen epäonnistui: ' + result.error);
        }
    } catch (error) {
        console.error('Error creating species:', error);
        showError('Lajin luominen epäonnistui');
    }
} 

// Toggle project details
function toggleProjectDetails(projectId) {
    const detailsDiv = document.getElementById(`details-${projectId}`);
    const btn = document.querySelector(`#child-project-${projectId} .toggle-details-btn`);
    // If closed, open and close others
    if (detailsDiv.style.display === 'none') {
        // Close other open details and reset their buttons
        document.querySelectorAll('.project-details').forEach(d => {
            if (d !== detailsDiv) {
                d.style.display = 'none';
                const pid = d.id.replace('details-','');
                const otherBtn = document.querySelector(`#child-project-${pid} .toggle-details-btn`);
                if (otherBtn) {
                    otherBtn.setAttribute('aria-expanded','false');
                    const c = otherBtn.querySelector('.caret'); if (c) c.textContent = '▶';
                    const l = otherBtn.querySelector('.btn-label'); if (l) l.textContent = 'Näytä aineistot';
                }
            }
        });

        detailsDiv.style.display = 'block';
        if (btn) {
            btn.setAttribute('aria-expanded','true');
            const c = btn.querySelector('.caret'); if (c) c.textContent = '▼';
            const l = btn.querySelector('.btn-label'); if (l) l.textContent = 'Piilota aineistot';
        }
        loadProjectDatasets(projectId);
        // Smoothly bring the opened datasets list into view for clarity (prefer datasets list)
        const ds = document.getElementById(`datasets-${projectId}`);
        if (ds) {
            ds.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        } else {
            detailsDiv.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    } else {
        detailsDiv.style.display = 'none';
        if (btn) {
            btn.setAttribute('aria-expanded','false');
            const c = btn.querySelector('.caret'); if (c) c.textContent = '▶';
            const l = btn.querySelector('.btn-label'); if (l) l.textContent = 'Näytä aineistot';
        }
    }
}

// Handle actions from native select
function handleActionSelect(selectElem, id) {
    const v = selectElem.value;
    if (!v) return;

    // Reset to placeholder so menu is ready for next use
    selectElem.selectedIndex = 0;

    if (v === 'edit') {
        toggleEditDescription(id);
    } else if (v === 'delete') {
        deleteProject(id);
    } else {
        // treat value as a tool path
        openTool(v, id);
    }
}

// Load datasets for a project
async function loadProjectDatasets(projectId) {
    try {
        const response = await fetch(`/api/projects/${projectId}/datasets`);
        const result = await response.json();
        displayProjectDatasets(projectId, result.datasets || []);
    } catch (error) {
        console.error('Error loading datasets:', error);
        document.getElementById(`datasets-${projectId}`).innerHTML = '<p>Aineistojen lataus epäonnistui</p>';
    }
}

// Display datasets for a project
function displayProjectDatasets(projectId, datasets) {
    const datasetsDiv = document.getElementById(`datasets-${projectId}`);
    
    if (datasets.length === 0) {
        datasetsDiv.innerHTML = '<p>Ei vielä aineistoja. Hae data ylhäältä!</p>';
        return;
    }
    
    let html = '<div class="dataset-list">';
    datasets.forEach(dataset => {
        html += `
            <div class="dataset-item" id="dataset-${dataset.dataset_id}">
                <div class="dataset-info">
                    <div><strong>Nimi:</strong> ${escapeHtml(dataset.dataset_name || 'Nimetön')}</div>
                    <div><strong>Havainnot:</strong> ${dataset.count}</div>
                    <div><strong>Lisätty:</strong> ${new Date(dataset.created_at).toLocaleString()}</div>
                    ${dataset.dataset_url ? `<div><strong>Lähde:</strong> <a href="${escapeHtml(dataset.dataset_url)}" target="_blank" style="word-break: break-all;">${escapeHtml(dataset.dataset_url)}</a></div>` : ''}
                </div>
                <div class="dataset-actions">
                    <button onclick="downloadDatasetAsCSV(${projectId}, '${dataset.dataset_id}')" class="btn-small btn-primary">Lataa</button>
                    ${dataset.dataset_url ? `<button onclick="reloadDatasetEncoded(${projectId}, '${dataset.dataset_id}', '${encodeURIComponent(dataset.dataset_url)}')" class="btn-small btn-primary">Päivitä</button>` : ''}
                    <button onclick="deleteDataset('${projectId}', '${dataset.dataset_id}')" class="btn-small btn-danger">Poista</button>
                </div>
            </div>
        `;
    });
    html += '</div>';
    
    datasetsDiv.innerHTML = html;
}

// Fetch data for project
async function fetchDataForProject(projectId) {
    const urlInput = document.getElementById(`url-${projectId}`);
    const url = urlInput.value.trim();
    
    if (!url) {
        showError('Syötä URL-osoite');
        return;
    }
    
    currentProject = projectId;
    
    // Show progress section
    const progressDiv = document.getElementById(`fetch-progress-${projectId}`);
    const progressLog = document.getElementById(`progress-log-${projectId}`);
    progressDiv.style.display = 'block';
    progressLog.innerHTML = '';
    
    // Use the existing parseUrl function from fetch_data.js
    try {
        // Call the existing fetch functionality
        await window.parseUrl(url, progressLog);
        
        // Show save section after fetch
        const saveSection = document.getElementById(`save-section-${projectId}`);
        saveSection.style.display = 'block';
    } catch (error) {
        showError('Haun suoritus epäonnistui: ' + error.message);
    }
}

// Save data to project
async function saveDataToProject(projectId) {
    if (!window.currentFetchedData) {
        showError('Ei tallennettavaa dataa. Hae data ensin.');
        return;
    }
    
    const datasetName = document.getElementById(`dataset-name-${projectId}`).value.trim();
    const currentApiUrl = window.currentFetchedUrl || '';
    
    try {
        const dataset_id = generateId();
        const response = await fetch('/api/observations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                project_id: projectId,
                dataset_id: dataset_id,
                dataset_name: datasetName || `Dataset ${new Date().toLocaleString()}`,
                dataset_url: currentApiUrl,
                features: window.currentFetchedData.features
            })
        });
        
        const result = await response.json();
        if (result.success) {
            showSuccess(`Aineisto tallennettu onnistuneesti! ${result.count} havaintoa tallennettu.`);
            
            // Clear inputs and hide sections
            document.getElementById(`url-${projectId}`).value = '';
            document.getElementById(`dataset-name-${projectId}`).value = '';
            document.getElementById(`save-section-${projectId}`).style.display = 'none';
            document.getElementById(`fetch-progress-${projectId}`).style.display = 'none';
            
            // Reload datasets and projects
            loadProjectDatasets(projectId);
            loadProjects();
            
            // Clear fetched data
            window.currentFetchedData = null;
            window.currentFetchedUrl = null;
        } else {
            showError('Aineiston tallennus epäonnistui: ' + result.error);
        }
    } catch (error) {
        console.error('Error saving data:', error);
        showError('Aineiston tallennus epäonnistui');
    }
}

// Upload CSV file and add observations to a project
async function uploadCsvToProject(projectId) {
    const fileInput = document.getElementById(`file-${projectId}`);
    if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
        showError('Valitse CSV-tiedosto lähetettäväksi');
        return;
    }
    const file = fileInput.files[0];
    const datasetName = document.getElementById(`dataset-name-${projectId}`).value.trim();

    const form = new FormData();
    form.append('file', file);
    if (datasetName) form.append('dataset_name', datasetName);

    const uploadProgress = document.getElementById(`upload-progress-${projectId}`);
    if (uploadProgress) { uploadProgress.style.display = 'block'; uploadProgress.textContent = 'Lähetetään…'; }

    try {
        const resp = await fetch(`/api/projects/${projectId}/upload_csv`, {
            method: 'POST',
            body: form
        });
        const result = await resp.json();
        if (result.success) {
            showSuccess(`Ladattu ${result.count} havaintoa`);
            fileInput.value = '';
            document.getElementById(`dataset-name-${projectId}`).value = '';
            loadProjectDatasets(projectId);
            loadProjects();
            if (uploadProgress) uploadProgress.style.display = 'none';
        } else {
            showError('Lataus epäonnistui: ' + result.error);
            if (uploadProgress) uploadProgress.style.display = 'none';
        }
    } catch (e) {
        console.error('Upload error', e);
        showError('Lähetys epäonnistui');
        if (uploadProgress) uploadProgress.style.display = 'none';
    }
}

// Download a specific dataset as CSV
async function downloadDatasetAsCSV(projectId, datasetId) {
    try {
        const response = await fetch(`/api/projects/${projectId}/download_csv?dataset_id=${encodeURIComponent(datasetId)}`);
        
        if (!response.ok) {
            const errorData = await response.json();
            showError('Lataus epäonnistui: ' + (errorData.error || response.statusText));
            return;
        }

        // Get the filename from Content-Disposition header
        const contentDisposition = response.headers.get('content-disposition');
        let filename = `dataset_${datasetId}.csv`;
        if (contentDisposition) {
            const filenameMatch = contentDisposition.match(/filename=([^;]+)/);
            if (filenameMatch) {
                filename = filenameMatch[1].replace(/"/g, '');
            }
        }

        // Get the CSV content as blob and trigger download
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(link);

        showSuccess('Aineisto ladattu onnistuneesti');
    } catch (e) {
        console.error('Download error:', e);
        showError('Aineiston lataus epäonnistui: ' + e.message);
    }
}

// Helper: decode encoded URL and call reload
function reloadDatasetEncoded(projectId, datasetId, encodedUrl) {
    try {
        const url = decodeURIComponent(encodedUrl || '');
        reloadDataset(projectId, datasetId, url);
    } catch (e) {
        console.error('Failed to decode dataset URL:', e);
        showError('Virheellinen aineiston URL-osoite');
    }
}

// Reload dataset: deletes existing dataset, fetches using the stored URL and saves with same dataset_id
async function reloadDataset(projectId, datasetId, url) {
    if (!url) {
        showError('Tälle aineistolle ei ole lähde-URL-osoitetta');
        return;
    }

    if (!confirm('Uudelleenlataus korvaa olemassa olevan aineiston. Jatketaanko?')) {
        return;
    }

    currentProject = projectId;

    // Show progress section
    const progressDiv = document.getElementById(`fetch-progress-${projectId}`);
    const progressLog = document.getElementById(`progress-log-${projectId}`);
    if (progressDiv && progressLog) {
        progressDiv.style.display = 'block';
        progressLog.innerHTML = '';
    }

    try {
        // Re-fetch data
        await window.parseUrl(url, progressLog);

        // Fetch dataset name (to preserve it) from server
        let datasetName = `Dataset ${new Date().toLocaleString()}`;
        try {
            const resp = await fetch(`/api/projects/${projectId}/datasets`);
            const res = await resp.json();
            const ds = (res.datasets || []).find(d => d.dataset_id === datasetId);
            if (ds && ds.dataset_name) datasetName = ds.dataset_name;
        } catch (e) {
            console.warn('Could not fetch existing dataset name, will use default');
        }

        // Delete existing dataset (replace without prompt)
        const delResp = await fetch(`/api/projects/${projectId}/datasets/${encodeURIComponent(datasetId)}`, { method: 'DELETE' });
        const delResult = await delResp.json();
        if (!delResult.success) {
            showError('Aineiston poistaminen ennen uudelleenlatausta epäonnistui: ' + (delResult.error || 'tuntematon virhe'));
            return;
        }

        // Save new data with the same dataset_id
        const response = await fetch('/api/observations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                project_id: projectId,
                dataset_id: datasetId,
                dataset_name: datasetName || `Dataset ${new Date().toLocaleString()}`,
                dataset_url: url,
                features: window.currentFetchedData ? window.currentFetchedData.features : []
            })
        });

        const result = await response.json();
        if (result.success) {
            showSuccess('Aineisto päivitetty onnistuneesti! ${result.count} havaintoa tallennettu.');
            // Refresh datasets and projects
            loadProjectDatasets(projectId);
            loadProjects();
            // Hide progress
            if (progressDiv) progressDiv.style.display = 'none';
            // Clear fetched data
            window.currentFetchedData = null;
            window.currentFetchedUrl = null;
        } else {
            showError('Uudelleenladatun aineiston tallennus epäonnistui: ' + result.error);
        }
    } catch (error) {
        console.error('Error reloading dataset:', error);
        showError('Aineiston uudelleenlataus epäonnistui: ' + (error.message || error));
    }
}

// Delete project
async function deleteProject(projectId) {
    if (!confirm('Haluatko varmasti poistaa tämän eliöryhmän? Kaikki aineistot ja havainnot poistetaan pysyvästi.')) {
        return;
    }
    
    try {
        const response = await fetch(`/api/projects/${projectId}`, {
            method: 'DELETE'
        });
        const result = await response.json();
        if (result.success) {
            showSuccess('Eliöryhmä poistettu onnistuneesti!');
            loadProjects();
        } else {
            showError('Eliöryhmän poistaminen epäonnistui: ' + result.error);
        }
    } catch (error) {
        console.error('Error deleting project:', error);
        showError('Eliöryhmän poistaminen epäonnistui');
    }
}

// Delete dataset from project
async function deleteDataset(projectId, datasetId) {
    if (!confirm('Haluatko varmasti poistaa tämän aineiston eliöryhmästä?')) {
        return;
    }
    
    try {
        const response = await fetch(`/api/projects/${projectId}/datasets/${datasetId}`, {
            method: 'DELETE'
        });
        const result = await response.json();
        if (result.success) {
            showSuccess('Aineisto poistettu onnistuneesti!');
            loadProjectDatasets(projectId);
            loadProjects();
        } else {
            showError('Aineiston poistaminen epäonnistui: ' + result.error);
        }
    } catch (error) {
        console.error('Error removing dataset:', error);
        showError('Aineiston poistaminen epäonnistui');
    }
}

// Open analysis tool
function openTool(toolPath, projectId) {
    window.location.href = `${toolPath}?id=${encodeURIComponent(projectId)}`;
}

// Helper function to truncate text to first n characters
function truncate(text, n) {
    if (!text) return '';
    return text.length > n ? text.slice(0, n) + '…' : text;
}

// Helper function to escape HTML
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

