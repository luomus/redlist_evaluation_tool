// App state
let currentProject = null;

// Initialize app on load
document.addEventListener('DOMContentLoaded', function() {
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
            showSuccess('Description updated successfully!');
            loadProjects();
        } else {
            showError('Failed to update description: ' + result.error);
        }
    } catch (error) {
        console.error('Error updating description:', error);
        showError('Failed to update description');
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
    
    if (projects.length === 0) {
        projectsList.innerHTML = '<p>No projects yet. Create one above!</p>';
        projectsDiv.style.display = 'block';
        return;
    }
    
    let html = '<div class="project-list">';
    projects.forEach(project => {
        html += `
            <div class="project-item parent-project" id="project-${project.id}" data-project-name="${escapeHtml(project.name).toLowerCase()}">
                <div class="project-header">
                    <h3>
                        <span class="toggle-children ${project.child_count > 0 ? '' : 'disabled'}" onclick="${project.child_count > 0 ? `toggleChildren(${project.id})` : 'return false;'}">${project.child_count > 0 ? '▶' : '○'}</span>
                        ${escapeHtml(project.name)}
                        <span class="child-count">(${project.child_count} subproject${project.child_count !== 1 ? 's' : ''})</span>
                    </h3>
                    <div class="project-actions">
                        <button onclick="showAddChildForm(${project.id})" class="btn-small btn-primary">+ Add Subproject</button>
                        <button onclick="toggleEditDescription(${project.id})" class="btn-small">Edit Description</button>
                        <button onclick="deleteProject(${project.id})" class="btn-small btn-danger">Delete</button>
                    </div>
                </div>
                ${project.description ? `<p class="project-description">${escapeHtml(project.description)}</p>` : '<p class="project-description" style="color: #999;">No description set</p>'}
                
                <!-- Edit Description Section -->
                <div id="edit-desc-${project.id}" style="display: none; margin: 10px 0; padding: 10px; background: #f8f9fa; border-radius: 4px;">
                    <div class="input-group">
                        <label>Description:</label>
                        <textarea id="edit-description-${project.id}" style="width: 100%; min-height: 80px;">${escapeHtml(project.description || '')}</textarea>
                    </div>
                    <button onclick="updateProjectDescription(${project.id})" class="btn-small">Save Description</button>
                    <button onclick="toggleEditDescription(${project.id})" class="btn-small">Cancel</button>
                </div>
                
                <!-- Add Child Project Form -->
                <div id="add-child-${project.id}" style="display: none; margin: 10px 0; padding: 10px; background: #e8f4f8; border-radius: 4px;">
                    <h4>Add New Subproject</h4>
                    <div class="input-group">
                        <label>Subproject Name:</label>
                        <input type="text" id="child-name-${project.id}" placeholder="Enter subproject name">
                    </div>
                    <div class="input-group">
                        <label>Description (optional):</label>
                        <textarea id="child-description-${project.id}" style="width: 100%; min-height: 60px;"></textarea>
                    </div>
                    <button onclick="createChildProject(${project.id})" class="btn-small">Create Subproject</button>
                    <button onclick="hideAddChildForm(${project.id})" class="btn-small">Cancel</button>
                </div>
                
                <div class="project-stats">
                    <span><strong>Total Datasets:</strong> ${project.dataset_count}</span>
                    <span><strong>Total Observations:</strong> ${project.observation_count}</span>
                    <span><strong>Created:</strong> ${new Date(project.created_at).toLocaleDateString()}</span>
                </div>
                
                <!-- Child Projects -->
                <div id="children-${project.id}" class="child-projects" style="display: none;">
                    ${project.children && project.children.length > 0 ? displayChildProjects(project.children) : '<p style="padding: 10px; color: #999;">No subprojects yet.</p>'}
                </div>
            </div>
        `;
    });
    html += '</div>';
    
    projectsList.innerHTML = html;
    projectsDiv.style.display = 'block';
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
                        <button class="btn-small" onclick="toggleProjectDetails(${child.id})">show or edit data sets</button>
                        <select class="tool-select" onchange="handleActionSelect(this, ${child.id})">
                            <option value="" selected disabled>Actions ▾</option>
                            <option value="/stats">View Stats</option>
                            <option value="/map">View/Edit on Map</option>
                            <option value="/grid">View Grid (AOO)</option>
                            <option value="/convex_hull">View Convex Hull (EOO)</option>
                            <option value="edit">Edit description</option>
                            <option value="delete">Delete species</option>
                        </select>
                    </div>
                </div>
                ${child.description ? `<p class="project-description">${escapeHtml(child.description)}</p>` : '<p class="project-description" style="color: #999; font-size: 0.9em;">No description</p>'}
                
                <!-- Edit Description Section -->
                <div id="edit-desc-${child.id}" style="display: none; margin: 10px 0; padding: 10px; background: #f8f9fa; border-radius: 4px;">
                    <div class="input-group">
                        <label>Description:</label>
                        <textarea id="edit-description-${child.id}" style="width: 100%; min-height: 60px;">${escapeHtml(child.description || '')}</textarea>
                    </div>
                    <button onclick="updateProjectDescription(${child.id})" class="btn-small">Save</button>
                    <button onclick="toggleEditDescription(${child.id})" class="btn-small">Cancel</button>
                </div>
                
                <div class="project-stats">
                    <span><strong>Datasets:</strong> ${child.dataset_count}</span>
                    <span><strong>Observations:</strong> ${child.observation_count}</span>
                </div>
                
                <div class="project-details" id="details-${child.id}" style="display: none;">
                    <!-- Add data section -->
                    <div class="add-data-section">
                        <h4>Add Data to Subproject</h4>
                        <div class="input-group">
                            <label>Enter Laji.fi observation search URL:</label>
                            <input type="text" id="url-${child.id}" placeholder="https://laji.fi/observation/list?time=-1%2F0">
                        </div>
                        <button onclick="fetchDataForProject(${child.id})" class="btn-fetch">Fetch Data</button>
                        
                        <div id="fetch-progress-${child.id}" class="fetch-progress" style="display: none;">
                            <h4>Fetching Progress:</h4>
                            <div id="progress-log-${child.id}"></div>
                        </div>
                        
                        <div id="save-section-${child.id}" style="display: none; margin-top: 15px;">
                            <div class="input-group">
                                <label>Dataset Name (optional):</label>
                                <input type="text" id="dataset-name-${child.id}" maxlength="256">
                            </div>
                            <button onclick="saveDataToProject(${child.id})" class="btn-save">Save to Subproject</button>
                        </div>
                    </div>
                    
                    <!-- Datasets list -->
                    <div class="datasets-section">
                        <h4>Datasets in Subproject</h4>
                        <div id="datasets-${child.id}">Loading...</div>
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
    
    if (childrenDiv.style.display === 'none') {
        childrenDiv.style.display = 'block';
        if (toggle) toggle.textContent = '▼';
    } else {
        childrenDiv.style.display = 'none';
        if (toggle) toggle.textContent = '▶';
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
        showError('Subproject name is required');
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
            showSuccess('Subproject created successfully!');
            hideAddChildForm(parentId);
            await loadProjects();
            // Auto-expand the parent to show the new child
            setTimeout(() => {
                const childrenDiv = document.getElementById(`children-${parentId}`);
                const toggle = document.querySelector(`#project-${parentId} .toggle-children`);
                if (childrenDiv && toggle) {
                    childrenDiv.style.display = 'block';
                    toggle.textContent = '▼';
                }
            }, 100);
        } else {
            showError('Failed to create subproject: ' + result.error);
        }
    } catch (error) {
        console.error('Error creating subproject:', error);
        showError('Failed to create subproject');
    }
} 

// Toggle project details
function toggleProjectDetails(projectId) {
    const detailsDiv = document.getElementById(`details-${projectId}`);
    if (detailsDiv.style.display === 'none') {
        detailsDiv.style.display = 'block';
        loadProjectDatasets(projectId);
    } else {
        detailsDiv.style.display = 'none';
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
        document.getElementById(`datasets-${projectId}`).innerHTML = '<p>Error loading datasets</p>';
    }
}

// Display datasets for a project
function displayProjectDatasets(projectId, datasets) {
    const datasetsDiv = document.getElementById(`datasets-${projectId}`);
    
    if (datasets.length === 0) {
        datasetsDiv.innerHTML = '<p>No datasets yet. Fetch data above!</p>';
        return;
    }
    
    let html = '<div class="dataset-list">';
    datasets.forEach(dataset => {
        html += `
            <div class="dataset-item">
                <div class="dataset-info">
                    <div><strong>Name:</strong> ${escapeHtml(dataset.dataset_name || 'Unnamed')}</div>
                    <div><strong>Records:</strong> ${dataset.count}</div>
                    <div><strong>Added:</strong> ${new Date(dataset.created_at).toLocaleString()}</div>
                </div>
                <button onclick="deleteDataset('${projectId}', '${dataset.dataset_id}')" class="btn-small btn-danger">Remove</button>
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
        showError('Please enter a URL');
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
        await window.parseUrl(url, projectId, progressLog);
        
        // Show save section after fetch
        const saveSection = document.getElementById(`save-section-${projectId}`);
        saveSection.style.display = 'block';
    } catch (error) {
        showError('Failed to fetch data: ' + error.message);
    }
}

// Save data to project
async function saveDataToProject(projectId) {
    if (!window.currentFetchedData) {
        showError('No data to save. Please fetch data first.');
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
            showSuccess(`Data saved successfully! ${result.count} observations stored.`);
            
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
            showError('Failed to save data: ' + result.error);
        }
    } catch (error) {
        console.error('Error saving data:', error);
        showError('Failed to save data');
    }
}

// Delete project
async function deleteProject(projectId) {
    if (!confirm('Are you sure you want to delete this project? All datasets and observations will be permanently removed.')) {
        return;
    }
    
    try {
        const response = await fetch(`/api/projects/${projectId}`, {
            method: 'DELETE'
        });
        const result = await response.json();
        if (result.success) {
            showSuccess('Project deleted successfully!');
            loadProjects();
        } else {
            showError('Failed to delete project: ' + result.error);
        }
    } catch (error) {
        console.error('Error deleting project:', error);
        showError('Failed to delete project');
    }
}

// Delete dataset from project
async function deleteDataset(projectId, datasetId) {
    if (!confirm('Are you sure you want to remove this dataset from the project?')) {
        return;
    }
    
    try {
        const response = await fetch(`/api/projects/${projectId}/datasets/${datasetId}`, {
            method: 'DELETE'
        });
        const result = await response.json();
        if (result.success) {
            showSuccess('Dataset removed successfully!');
            loadProjectDatasets(projectId);
            loadProjects();
        } else {
            showError('Failed to remove dataset: ' + result.error);
        }
    } catch (error) {
        console.error('Error removing dataset:', error);
        showError('Failed to remove dataset');
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

