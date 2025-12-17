const defaultState = {
    project: {
        name: 'Pilot 01',
        location: 'Palaiseau Campus',
        id: 'project-palaiseau',
        mapId: 'palaiseau-outdoor'
    },
    overlays: [
        { id: 'palaiseau-roads', label: 'Road network', file: '/static/data/palaiseau_roads.geojson', type: 'line', note: 'OSM roads for the outdoor view' },
        { id: 'walking-network', label: 'Walking network', file: '/static/data/walking_network.geojson', type: 'line', note: 'Pedestrian paths used for routes' },
        { id: 'mobility-infrastructure', label: 'Bike infrastructure', file: '/static/data/mobility_infrastructure.geojson', type: 'line', note: 'Cycleways and shared lanes' },
        { id: 'bus-lanes', label: 'Bus lanes', file: '/static/data/bus_lanes.geojson', type: 'line', note: 'Transit priority lanes' },
        { id: 'amenities', label: 'Amenities', file: '/static/data/amenities.geojson', type: 'point', note: 'Hospitals, schools, markets, libraries' },
        { id: 'telecom-floorplan', label: 'Telecom floorplan', file: '/static/data/images.jpg', type: 'image', note: 'Indoor overlay for the Telecom building' }
    ],
    maps: [
        {
            id: 'palaiseau-outdoor',
            label: 'IP Paris Campus',
            style: 'mapbox://styles/mapbox/light-v11',
            center: [2.2, 48.714],
            zoom: 15,
            pitch: 45,
            bearing: 40,
            overlays: ['palaiseau-roads', 'walking-network', 'mobility-infrastructure', 'bus-lanes', 'amenities'],
            description: 'Base view for the campus and surroundings'
        },
        {
            id: 'telecom-floorplan-view',
            label: 'Telecom indoor',
            style: 'mapbox://styles/mapbox/light-v11',
            center: [2.2005, 48.7138],
            zoom: 17,
            pitch: 0,
            bearing: 0,
            overlays: ['telecom-floorplan'],
            description: 'Image overlay for indoor exercises'
        }
    ],
    questions: [
        {
            id: 'arrival-mode',
            text: 'How do you typically travel to campus?',
            type: 'single-choice',
            options: ['Walk', 'Bike', 'Bus', 'Car', 'Other'],
            required: true,
            responseShape: 'scalar',
            mapId: null,
            order: 1
        },
        {
            id: 'bike-lanes',
            text: 'Where should we add bike lanes?',
            type: 'sticker',
            options: [],
            required: false,
            responseShape: 'point-collection',
            mapId: null,
            order: 2
        },
        {
            id: 'confusing-areas',
            text: 'Where do you get confused?',
            type: 'sticker',
            options: [],
            required: false,
            responseShape: 'point-collection',
            mapId: null,
            order: 3
        },
        {
            id: 'priority-corridors',
            text: 'Draw corridors for pedestrians.',
            type: 'drawing',
            options: [],
            required: false,
            responseShape: 'line-string',
            mapId: null,
            order: 4
        }
    ]
};

let state = JSON.parse(JSON.stringify(defaultState));
let projects = [];
let selectedQuestionId = null; 
let isSwitching = false; 
let draggedQuestionId = null; // Track dragged item

const els = {
    projectName: document.getElementById('project-name'),
    projectLocation: document.getElementById('project-location'),
    projectId: document.getElementById('project-id'),
    projectPill: document.getElementById('project-pill'),
    mapList: document.getElementById('map-list'),
    mapStyle: document.getElementById('map-style'),
    mapCenter: document.getElementById('map-center'),
    mapZoom: document.getElementById('map-zoom'),
    mapPitch: document.getElementById('map-pitch'),
    mapBearing: document.getElementById('map-bearing'),
    mapLabel: document.getElementById('map-label'),
    mapDetailTitle: document.getElementById('selected-map-title'),
    mapDetailPill: document.getElementById('selected-map-pill'),
    deleteMapBtn: document.getElementById('delete-map'),
    overlayItems: document.getElementById('overlay-items'),
    toggleAllOverlays: document.getElementById('toggle-all-overlays'),
    projectList: document.getElementById('project-list'),
    newProject: document.getElementById('new-project'),
    refreshProjects: document.getElementById('refresh-projects'),
    saveServer: document.getElementById('save-server'),
    downloadConfig: document.getElementById('download-config'),
    saveStatus: document.getElementById('save-status'),
    questionList: document.getElementById('question-list'),
    addQuestionBtn: document.getElementById('add-question'),
    
    questionDetailTitle: document.getElementById('selected-question-title'),
    questionText: document.getElementById('question-text'),
    questionType: document.getElementById('question-type'),
    questionMapPreset: document.getElementById('question-map-preset'),
    questionOptions: document.getElementById('question-options'),
    questionOptionsContainer: document.getElementById('question-options-container'),
    deleteQuestionBtn: document.getElementById('delete-question'),

    addMapBtn: document.getElementById('add-map'),
};

function slugify(text) {
    return text
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '')
        .slice(0, 40) || 'item';
}

function parseCenter(value) {
    const parts = value.split(',').map(v => parseFloat(v.trim()));
    if (parts.length === 2 && parts.every(v => Number.isFinite(v))) {
        return parts;
    }
    return null;
}

async function fetchServerConfig() {
    try {
        const res = await fetch('/api/config');
        if (res.ok) {
            const data = await res.json();
            return data;
        }
    } catch (err) {
        console.warn('No server config found', err);
    }
    return null;
}

function mergeState(serverConfig) {
    if (!serverConfig) return;
    state = JSON.parse(JSON.stringify(defaultState));
    state.project = { ...defaultState.project, ...(serverConfig.project || {}) };
    state.overlays = (serverConfig.overlays && serverConfig.overlays.length > 0) ? serverConfig.overlays : defaultState.overlays;
    state.maps = (serverConfig.maps && serverConfig.maps.length > 0) ? serverConfig.maps : defaultState.maps;
    state.questions = serverConfig.questions || serverConfig.questionFlow || defaultState.questions;
    // Flatten if we got groups from old config
    if (serverConfig.questionGroups) {
        state.questions = [];
        serverConfig.questionGroups.forEach(g => {
            if (g.questions) state.questions.push(...g.questions);
        });
    }

    if (!state.project.mapId && state.maps.length) {
        state.project.mapId = state.maps[0].id;
    }
}

async function loadProjectsList() {
    try {
        const res = await fetch('/api/projects');
        if (res.ok) {
            projects = await res.json();
        } else {
            projects = [];
        }
    } catch (err) {
        projects = [];
    }
    renderProjectList();
}

async function loadProjectById(projectId) {
    try {
        const res = await fetch(`/api/config?project=${encodeURIComponent(projectId)}`);
        if (res.ok) {
            const cfg = await res.json();
            mergeState(cfg);
            renderProject();
            renderMapCards();
            renderMapDetails();
            renderOverlayList();
            renderQuestions();
            
            const allRows = els.projectList.querySelectorAll('.project-row');
            allRows.forEach(row => {
                const openBtn = row.querySelector('.open-project');
                if (openBtn && openBtn.dataset.projectId === projectId) {
                    row.classList.add('active');
                } else {
                    row.classList.remove('active');
                }
            });

            markSaved(`Loaded ${projectId}`);
            return;
        }
    } catch (err) {
    }
    markSaved('Failed to load project');
}

function hasUnsavedChanges() {
    return els.saveStatus.textContent === 'Unsaved changes';
}

function checkUnsavedChanges() {
    if (hasUnsavedChanges()) {
        return confirm('You have unsaved changes. Are you sure you want to discard them?');
    }
    return true;
}

function newProject() {
    if (!checkUnsavedChanges()) return;
    state = JSON.parse(JSON.stringify(defaultState));
    const tempId = `project-${Date.now()}`;
    state.project.id = tempId;
    state.project.name = 'New Project';
    state.project.location = '';
    
    if (!state.project.mapId && state.maps.length) {
        state.project.mapId = state.maps[0].id;
    }

    // Assign default map to all questions if missing
    if (state.maps.length > 0) {
        state.questions.forEach(q => {
            if (!q.mapId) {
                q.mapId = state.maps[0].id;
            }
        });
    }

    renderProject();
    renderMapCards();
    renderMapDetails();
    renderOverlayList();
    renderQuestions();
    
    const allRows = els.projectList.querySelectorAll('.project-row');
    allRows.forEach(row => row.classList.remove('active'));

    persistStateToServer().then(() => {
        markSaved('New project created');
        document.querySelector('.grid').scrollIntoView({ behavior: 'smooth' });
    });
}

function markSaved(text) {
    els.saveStatus.textContent = text;
}

function renderProject() {
    els.projectName.value = state.project.name || '';
    els.projectLocation.value = state.project.location || '';
    els.projectId.value = state.project.id || '';
    els.projectPill.textContent = state.project.id || 'Project';
}

function renderProjectList() {
    if (!els.projectList) return;
    els.projectList.innerHTML = '';
    const sorted = [...projects].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    sorted.forEach(proj => {
        const card = document.createElement('div');
        const isActive = proj.id === state.project.id;
        card.className = `project-row ${isActive ? 'active' : ''}`;
        card.innerHTML = `
            <div class="project-info">
                <h4>${proj.name || proj.id}</h4>
            </div>
            <div class="hero-actions">
                <button class="ghost-btn small delete-project" data-project-id="${proj.id}" style="color:var(--danger); border-color:var(--danger); opacity:0.7;">Delete</button>
                <button class="ghost-btn small open-project" data-project-id="${proj.id}">Open</button>
            </div>
        `;
        
        const openBtn = card.querySelector('.open-project');
        openBtn.addEventListener('click', (e) => {
            e.stopPropagation(); 
            window.location.href = `/app?project=${encodeURIComponent(proj.id)}`;
        });

        card.addEventListener('click', () => {
            if (proj.id === state.project.id) return;
            if (!checkUnsavedChanges()) return;
            loadProjectById(proj.id);
        });

        const deleteBtn = card.querySelector('.delete-project');
        deleteBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (confirm(`Are you sure you want to delete project "${proj.name || proj.id}"?\nThis action cannot be undone.`)) {
                try {
                    const res = await fetch(`/api/projects/${proj.id}`, { method: 'DELETE' });
                    if (res.ok) {
                        await loadProjectsList();
                    } else {
                        alert('Failed to delete project');
                    }
                } catch (err) {
                    alert('Error deleting project');
                }
            }
        });

        els.projectList.appendChild(card);
    });
}

function renderMapCards() {
    els.mapList.innerHTML = '';
    renderQuestionMapSelect(); 
    state.maps.forEach(map => {
        const card = document.createElement('div');
        card.className = `map-card ${map.id === state.project.mapId ? 'active' : ''}`;
        card.dataset.id = map.id;
        card.innerHTML = `
            <h4>${map.label}</h4>
            <div class="map-meta">
                <span>${map.description || 'No description'}</span>
                <span>Style: ${map.style}</span>
                <span>Center: ${map.center.join(', ')} | Zoom: ${map.zoom}</span>
            </div>
            <div class="chip-row">
                ${map.overlays.map(o => `<span class="chip">${o}</span>`).join('')}
            </div>
        `;
        card.addEventListener('click', () => {
            state.project.mapId = map.id;
            markSaved('Unsaved changes');
            renderMapCards();
            renderMapDetails();
            renderOverlayList();
        });
        els.mapList.appendChild(card);
    });
}

function renderQuestionMapSelect() {
    if (!els.questionMapPreset) return;
    const currentVal = els.questionMapPreset.value;
    els.questionMapPreset.innerHTML = '';
    state.maps.forEach(map => {
        const option = document.createElement('option');
        option.value = map.id;
        option.textContent = map.label || map.id;
        els.questionMapPreset.appendChild(option);
    });
    
    // Set default if empty
    if (!currentVal && state.maps.length > 0) {
       els.questionMapPreset.value = state.maps[0].id;
    } else if (state.maps.some(m => m.id === currentVal)) {
        els.questionMapPreset.value = currentVal;
    }
}

function renderMapDetails() {
    const selected = state.maps.find(m => m.id === state.project.mapId);
    if (!selected) return;

    els.mapDetailTitle.textContent = selected.label || 'Untitled Map';
    els.mapLabel.value = selected.label || '';
    els.mapDetailPill.textContent = selected.id;
    els.mapStyle.value = selected.style || '';
    els.mapCenter.value = selected.center ? selected.center.join(', ') : '';
    els.mapZoom.value = selected.zoom ?? '';
    els.mapPitch.value = selected.pitch ?? '';
    els.mapBearing.value = selected.bearing ?? '';
}

function updateSelectedMap(updates) {
    const selected = state.maps.find(m => m.id === state.project.mapId);
    if (!selected) return;
    Object.assign(selected, updates);
    markSaved('Unsaved changes');
    renderMapCards();
}

function deleteMap() {
    if (state.maps.length <= 1) {
        alert("Cannot delete the only map. Add another map first.");
        return;
    }
    if (!confirm("Delete this map preset?")) return;

    const deletedId = state.project.mapId;
    state.maps = state.maps.filter(m => m.id !== deletedId);
    
    state.questions.forEach(q => {
        if (q.mapId === deletedId) q.mapId = null;
    });

    state.project.mapId = state.maps[0].id;
    
    markSaved('Unsaved changes');
    renderMapCards();
    renderMapDetails();
    renderOverlayList();
    renderQuestions(); 
}

function renderOverlayList() {
    const selected = state.maps.find(m => m.id === state.project.mapId);
    if (!selected) return;
    els.overlayItems.innerHTML = '';

    if (!state.overlays || state.overlays.length === 0) {
        els.overlayItems.innerHTML = '<div style="padding:10px; color:var(--muted); font-style:italic;">No layers defined in project configuration.</div>';
        return;
    }

    state.overlays.forEach(layer => {
        const wrapper = document.createElement('div');
        wrapper.className = 'overlay-item';
        const checked = selected.overlays.includes(layer.id);
        wrapper.innerHTML = `
            <div class="info">
                <strong>${layer.label}</strong>
                <small>${layer.file}</small>
                <small>${layer.note || ''}</small>
            </div>
            <input type="checkbox" ${checked ? 'checked' : ''} data-layer="${layer.id}">
        `;
        const checkbox = wrapper.querySelector('input');
        checkbox.addEventListener('change', () => {
            if (checkbox.checked && !selected.overlays.includes(layer.id)) {
                selected.overlays.push(layer.id);
            } else if (!checkbox.checked) {
                selected.overlays = selected.overlays.filter(id => id !== layer.id);
            }
            markSaved('Unsaved changes');
            renderMapCards();
        });
        els.overlayItems.appendChild(wrapper);
    });
}

function toggleAllOverlays() {
    const selected = state.maps.find(m => m.id === state.project.mapId);
    if (!selected) return;
    const allEnabled = selected.overlays.length === state.overlays.length;
    selected.overlays = allEnabled ? [] : state.overlays.map(o => o.id);
    markSaved('Unsaved changes');
    renderOverlayList();
    renderMapCards();
}

function addMapFromForm() {
    const id = `map-${Date.now()}`;
    const newMap = {
        id,
        label: 'New Map',
        style: 'mapbox://styles/mapbox/light-v11',
        center: [2.2, 48.714],
        zoom: 15,
        pitch: 0,
        bearing: 0,
        overlays: [],
        description: 'New custom map'
    };

    state.maps.push(newMap);
    state.project.mapId = id;
    
    markSaved('Unsaved changes');
    renderMapCards();
    renderMapDetails();
    renderOverlayList();
}

function renderQuestions() {
    els.questionList.innerHTML = '';
    state.questions.forEach((q, index) => {
        const mapObj = state.maps.find(m => m.id === q.mapId);
        const mapLabel = mapObj ? (mapObj.label || mapObj.id) : q.mapId;
        const isActive = selectedQuestionId === q.id;
        
        const card = document.createElement('div');
        card.className = `question-chip ${isActive ? 'active' : ''}`;
        card.dataset.id = q.id;
        card.dataset.index = index;
        card.draggable = true;

        if (isActive) {
            card.style.borderColor = 'var(--accent)';
            card.style.background = 'rgba(94, 234, 212, 0.1)';
        }
        card.style.cursor = 'grab';
        card.style.display = 'block';
        card.style.marginBottom = '8px';
        
        card.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; pointer-events:none;">
                <span class="type">${q.type}</span>
                ${q.mapId ? `<span class="pill light tiny" style="font-size:10px; padding:2px 6px;">${mapLabel}</span>` : ''}
            </div>
            <div style="margin-top:4px; pointer-events:none;">${q.text}</div>
        `;

        card.addEventListener('click', () => {
            selectQuestion(q.id);
        });

        // Drag and Drop Events
        card.addEventListener('dragstart', (e) => {
            draggedQuestionId = q.id;
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', index);
            card.style.opacity = '0.4';
        });

        card.addEventListener('dragend', () => {
            card.style.opacity = '1';
            draggedQuestionId = null;
            const allCards = els.questionList.querySelectorAll('.question-chip');
            allCards.forEach(c => c.classList.remove('drag-over'));
        });

        card.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            card.classList.add('drag-over');
        });

        card.addEventListener('dragleave', () => {
            card.classList.remove('drag-over');
        });

        card.addEventListener('drop', (e) => {
            e.preventDefault();
            card.classList.remove('drag-over');
            const fromIndex = parseInt(e.dataTransfer.getData('text/plain'));
            const toIndex = index;

            if (fromIndex !== toIndex) {
                // Reorder array
                const movedItem = state.questions[fromIndex];
                state.questions.splice(fromIndex, 1);
                state.questions.splice(toIndex, 0, movedItem);
                
                // Update order property
                state.questions.forEach((q, idx) => {
                    q.order = idx + 1;
                });

                markSaved('Unsaved changes');
                renderQuestions();
            }
        });

        els.questionList.appendChild(card);
    });
}

function selectQuestion(questionId) {
    isSwitching = true; 
    selectedQuestionId = questionId;
    renderQuestions(); 
    renderQuestionDetails();
    isSwitching = false; 
}

function renderQuestionDetails() {
    if (!selectedQuestionId) {
        els.questionDetailTitle.textContent = 'No question selected';
        els.questionText.value = '';
        els.questionType.value = 'text';
        els.questionMapPreset.value = '';
        if (els.questionOptionsContainer) els.questionOptionsContainer.style.display = 'none';
        els.questionText.disabled = true;
        els.questionType.disabled = true;
        els.questionMapPreset.disabled = true;
        els.deleteQuestionBtn.disabled = true;
        return;
    }

    const q = state.questions.find(q => q.id === selectedQuestionId);
    if (!q) return;

    els.questionDetailTitle.textContent = 'Edit Question';
    
    els.questionText.disabled = false;
    els.questionType.disabled = false;
    els.questionMapPreset.disabled = false;
    els.deleteQuestionBtn.disabled = false;

    els.questionText.value = q.text || '';
    els.questionType.value = q.type || 'text';
    els.questionMapPreset.value = q.mapId || '';
    
    // Auto-select first map if null
    if (!q.mapId && state.maps.length > 0) {
        q.mapId = state.maps[0].id;
        els.questionMapPreset.value = q.mapId;
    } else if (els.questionMapPreset.value !== (q.mapId || '')) {
         // Check if map still exists
         if (state.maps.some(m => m.id === q.mapId)) {
             els.questionMapPreset.value = q.mapId;
         } else {
             q.mapId = state.maps[0].id; // Fallback
             els.questionMapPreset.value = q.mapId;
         }
    }

    if (['single-choice', 'multi-choice'].includes(q.type)) {
         if (els.questionOptionsContainer) els.questionOptionsContainer.style.display = 'block';
         els.questionOptions.value = (q.options || []).join('\n');
    } else {
         if (els.questionOptionsContainer) els.questionOptionsContainer.style.display = 'none';
    }
}

function updateSelectedQuestion() {
    if (isSwitching) return; 
    if (!selectedQuestionId) return;
    const q = state.questions.find(q => q.id === selectedQuestionId);
    if (!q) return;

    q.text = els.questionText.value;
    q.type = els.questionType.value; 
    q.mapId = els.questionMapPreset.value || null;
    
    if (['single-choice', 'multi-choice'].includes(q.type)) {
        q.options = els.questionOptions.value.split('\n').map(s => s.trim()).filter(Boolean);
        if (els.questionOptionsContainer) els.questionOptionsContainer.style.display = 'block';
    } else {
        if (els.questionOptionsContainer) els.questionOptionsContainer.style.display = 'none';
    }

    markSaved('Unsaved changes');
    renderQuestions(); 
}

function addDefaultQuestion() {
    const defaultMapId = state.maps.length > 0 ? state.maps[0].id : null;
    const newQ = {
        id: `q-${Date.now()}`,
        text: 'New Question',
        type: 'text',
        options: [],
        required: true,
        mapId: defaultMapId,
        order: state.questions.length + 1
    };

    state.questions.push(newQ);
    
    markSaved('Unsaved changes');
    selectQuestion(newQ.id);
}

function deleteSelectedQuestion() {
    if (!selectedQuestionId) return;
    if (!confirm('Delete this question?')) return;
    
    state.questions = state.questions.filter(q => q.id !== selectedQuestionId);
    selectedQuestionId = null;
    markSaved('Unsaved changes');
    renderQuestions();
    renderQuestionDetails();
}

function buildAnswerTemplate() {
    const template = {};
    state.questions.forEach(q => {
        template[q.id] = {
            questionId: q.id,
            type: q.type,
            responseShape: q.responseShape,
            required: q.required,
            answers: []
        };
    });
    return template;
}

function buildPreviewConfig() {
    const selectedMap = state.maps.find(m => m.id === state.project.mapId) || state.maps[0];
    const overlayDetails = state.overlays;
    const questionFlow = state.questions.map((q, index) => ({
        id: q.id,
        text: q.text,
        type: q.type,
        options: q.options,
        required: q.required,
        responseShape: q.responseShape,
        mapId: q.mapId || null,
        order: index + 1 // Ensure strict order based on array position
    }));

    return {
        project: state.project,
        maps: state.maps,
        map: selectedMap,
        overlays: overlayDetails,
        questionFlow,
        responseTemplate: buildAnswerTemplate()
    };
}



function downloadConfig() {
    const blob = new Blob([JSON.stringify(buildPreviewConfig(), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${state.project.id || 'project'}-config.json`;
    a.click();
    URL.revokeObjectURL(url);
    markSaved('Downloaded');
}

async function persistStateToServer() {
    try {
        const response = await fetch('/api/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ config: buildPreviewConfig() })
        });
        if (response.ok) {
            markSaved('Saved to server');
            await loadProjectsList(); 
            
            const currentId = state.project.id;
            const allRows = els.projectList.querySelectorAll('.project-row');
            allRows.forEach(row => {
                const openBtn = row.querySelector('.open-project');
                if (openBtn && openBtn.dataset.projectId === currentId) {
                    row.classList.add('active');
                } else {
                    row.classList.remove('active');
                }
            });
        } else {
            markSaved('Server save failed');
        }
    } catch (error) {
        markSaved('Server save failed');
    }
}

function initEvents() {
    els.projectName.addEventListener('input', e => {
        state.project.name = e.target.value;
        markSaved('Unsaved changes');
    });
    els.projectLocation.addEventListener('input', e => {
        state.project.location = e.target.value;
        markSaved('Unsaved changes');
    });
    els.projectId.addEventListener('input', e => {
        state.project.id = slugify(e.target.value || 'project');
        els.projectPill.textContent = state.project.id; 
        markSaved('Unsaved changes');
    });

    els.mapStyle.addEventListener('input', e => updateSelectedMap({ style: e.target.value }));
    els.mapCenter.addEventListener('input', e => {
        const center = parseCenter(e.target.value);
        if (center) updateSelectedMap({ center });
    });
    els.mapZoom.addEventListener('input', e => updateSelectedMap({ zoom: parseFloat(e.target.value) || 0 }));
    els.mapPitch.addEventListener('input', e => updateSelectedMap({ pitch: parseFloat(e.target.value) || 0 }));
    els.mapBearing.addEventListener('input', e => updateSelectedMap({ bearing: parseFloat(e.target.value) || 0 }));
    els.mapLabel.addEventListener('input', e => {
        updateSelectedMap({ label: e.target.value });
        els.mapDetailTitle.textContent = e.target.value || 'Untitled Map';
    });
    els.deleteMapBtn.addEventListener('click', deleteMap);

    els.toggleAllOverlays.addEventListener('click', toggleAllOverlays);
    els.addMapBtn.addEventListener('click', addMapFromForm);

    els.addQuestionBtn.addEventListener('click', addDefaultQuestion);
    
    // Question detail listeners
    els.deleteQuestionBtn.addEventListener('click', deleteSelectedQuestion);
    
    els.questionText.addEventListener('input', updateSelectedQuestion); 
    els.questionType.addEventListener('change', () => {
        updateSelectedQuestion(); 
        renderQuestionDetails(); 
    });
    els.questionMapPreset.addEventListener('change', updateSelectedQuestion);
    if(els.questionOptions) els.questionOptions.addEventListener('input', updateSelectedQuestion);

    els.saveServer?.addEventListener('click', persistStateToServer);
    els.downloadConfig.addEventListener('click', downloadConfig);
    els.refreshProjects?.addEventListener('click', loadProjectsList);
    els.newProject?.addEventListener('click', newProject);
}

async function init() {
    const serverConfig = await fetchServerConfig();
    mergeState(serverConfig);
    renderProject();
    renderMapCards();
    renderMapDetails();
    renderOverlayList();
    renderQuestions();
    await loadProjectsList();
    initEvents();
    markSaved(serverConfig ? 'Loaded from server' : 'Loaded defaults');
}

init();
