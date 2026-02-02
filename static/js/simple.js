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
            <div class="project-item" id="project-${project.id}" data-project-name="${escapeHtml(project.name).toLowerCase()}">
                <div class="project-header">
                    <h3>${escapeHtml(project.name)}</h3>
                    <div class="project-actions">
                        <button onclick="toggleEditDescription('${project.id}')" class="btn-small">Edit Description</button>
                        <button onclick="toggleProjectDetails('${project.id}')" class="btn-small">Details</button>
                        <button onclick="deleteProject('${project.id}')" class="btn-small btn-danger">Delete</button>
                    </div>
                </div>
                ${project.description ? `<p class="project-description">${escapeHtml(project.description)}</p>` : '<p class="project-description" style="color: #999;">No description set</p>'}
                
                <!-- Edit Description Section -->
                <div id="edit-desc-${project.id}" style="display: none; margin: 10px 0; padding: 10px; background: #f8f9fa; border-radius: 4px;">
                    <div class="input-group">
                        <label>Description:</label>
                        <textarea id="edit-description-${project.id}" style="width: 100%; min-height: 80px;">${escapeHtml(project.description || '')}</textarea>
                    </div>
                    <button onclick="updateProjectDescription('${project.id}')" class="btn-small">Save Description</button>
                    <button onclick="toggleEditDescription('${project.id}')" class="btn-small">Cancel</button>
                </div>
                
                <div class="project-stats">
                    <span><strong>Datasets:</strong> ${project.dataset_count}</span>
                    <span><strong>Observations:</strong> ${project.observation_count}</span>
                    <span><strong>Created:</strong> ${new Date(project.created_at).toLocaleDateString()}</span>
                </div>
                
                <div class="project-details" id="details-${project.id}" style="display: none;">
                    <!-- Add data section -->
                    <div class="add-data-section">
                        <h4>Add Data to Project</h4>
                        <div class="input-group">
                            <label>Enter Laji.fi observation search URL:</label>
                            <input type="text" id="url-${project.id}" placeholder="https://laji.fi/observation/list?time=-1%2F0">
                        </div>
                        <button onclick="fetchDataForProject('${project.id}')" class="btn-fetch">Fetch Data</button>
                        
                        <div id="fetch-progress-${project.id}" class="fetch-progress" style="display: none;">
                            <h4>Fetching Progress:</h4>
                            <div id="progress-log-${project.id}"></div>
                        </div>
                        
                        <div id="save-section-${project.id}" style="display: none; margin-top: 15px;">
                            <div class="input-group">
                                <label>Dataset Name (optional):</label>
                                <input type="text" id="dataset-name-${project.id}" maxlength="256">
                            </div>
                            <button onclick="saveDataToProject('${project.id}')" class="btn-save">Save to Project</button>
                        </div>
                    </div>
                    
                    <!-- Datasets list -->
                    <div class="datasets-section">
                        <h4>Datasets in Project</h4>
                        <div id="datasets-${project.id}">Loading...</div>
                    </div>
                    
                    <!-- Tools section -->
                    <div class="tools-section">
                        <h4>Analysis Tools</h4>
                        <div class="tool-buttons">
                            <button onclick="openTool('/stats', '${project.id}')">View Stats</button>
                            <button onclick="openTool('/map', '${project.id}')">View/Edit on Map</button>
                            <button onclick="openTool('/grid', '${project.id}')">View Grid (AOO)</button>
                            <button onclick="openTool('/convex_hull', '${project.id}')">View Convex Hull (EOO)</button>
                        </div>
                    </div>
                </div>
            </div>
        `;
    });
    html += '</div>';
    
    projectsList.innerHTML = html;
    projectsDiv.style.display = 'block';
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

