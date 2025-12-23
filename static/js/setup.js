const defaultState = {
    project: {
        name: 'Pilot 01',
        location: 'Palaiseau Campus',
        id: 'project-palaiseau',
        mapId: 'palaiseau-outdoor',
        rearProjection: false,
        tuiMode: false
    },
    overlays: [
        { id: 'palaiseau-roads', label: 'Road network', file: '/static/data/palaiseau_roads.geojson', type: 'line', note: 'OSM roads for the outdoor view' },
        { id: 'walking-network', label: 'Walking network', file: '/static/data/walking_network.geojson', type: 'line', note: 'Pedestrian paths used for routes' },
        { id: 'mobility-infrastructure', label: 'Bike network', file: '/static/data/mobility_infrastructure.geojson', type: 'line', note: 'Cycleways and shared lanes' },
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
let sortableInstance = null;

const els = {
    projectName: document.getElementById('project-name'),
    projectLocation: document.getElementById('project-location'),
    projectId: document.getElementById('project-id'),
    projectPill: document.getElementById('project-pill'),
    projectRearProjection: document.getElementById('project-rear-projection'),
    projectTuiMode: document.getElementById('project-tui-mode'),
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
    projectDropdown: document.getElementById('project-dropdown'),
    newProject: document.getElementById('new-project'),
    deleteProject: document.getElementById('delete-project'),
    saveServer: document.getElementById('save-server'),
    downloadConfig: document.getElementById('download-config'),
    openProject: document.getElementById('open-project'),
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
    renderProjectDropdown();
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
            renderProjectDropdown();

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

    persistStateToServer().then(() => {
        markSaved('New project created');
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
    if (els.projectRearProjection) {
        els.projectRearProjection.checked = !!state.project.rearProjection;
    }
    if (els.projectTuiMode) {
        els.projectTuiMode.checked = !!state.project.tuiMode;
    }
}

function renderProjectDropdown() {
    if (!els.projectDropdown) return;
    const currentValue = els.projectDropdown.value;
    els.projectDropdown.innerHTML = '<option value="">Select or create a project...</option>';

    const sorted = [...projects].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    sorted.forEach(proj => {
        const option = document.createElement('option');
        option.value = proj.id;
        option.textContent = proj.name || proj.id;
        els.projectDropdown.appendChild(option);
    });

    // Restore selection
    if (state.project && state.project.id) {
        els.projectDropdown.value = state.project.id;
    } else if (currentValue) {
        els.projectDropdown.value = currentValue;
    }
}

function renderMapCards() {
    els.mapList.innerHTML = '';
    renderQuestionMapSelect(); 
    state.maps.forEach(map => {
        const card = document.createElement('div');
        card.className = `map-card bg-bg-secondary border-2 border-border-subtle rounded-lg p-4 cursor-pointer transition-all duration-200 hover:border-border-focus hover:-translate-y-0.5 ${map.id === state.project.mapId ? 'active border-accent-primary bg-blue-500/5' : ''}`;
        card.dataset.id = map.id;
        card.innerHTML = `
            <h4 class="mb-2 text-base font-semibold text-text-primary m-0">${map.label}</h4>
            <div class="text-sm text-text-secondary leading-6 block">
                <span class="block mb-1">${map.description || 'No description'}</span>
                <span class="block mb-1">Style: ${map.style}</span>
                <span class="block mb-1">Center: ${map.center.join(', ')} | Zoom: ${map.zoom}</span>
            </div>
            <div class="flex flex-wrap gap-1 mt-3">
                ${map.overlays.map(o => `<span class="px-2 py-0.5 bg-bg-tertiary border border-border-subtle rounded text-xs text-text-muted">${o}</span>`).join('')}
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
        wrapper.className = 'overlay-item flex justify-between items-center p-3 bg-bg-tertiary border border-border-subtle rounded-md transition-colors duration-200 hover:border-border-focus';
        const checked = selected.overlays.includes(layer.id);
        wrapper.innerHTML = `
            <div class="flex-1">
                <strong class="block text-text-primary text-sm mb-0.5">${layer.label}</strong>
                <small class="block text-text-secondary text-xs">${layer.file}</small>
            </div>
            <input type="checkbox" ${checked ? 'checked' : ''} data-layer="${layer.id}" class="w-[18px] h-[18px] cursor-pointer flex-shrink-0">
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
        card.className = `question-chip p-3 bg-bg-tertiary border-2 border-border-subtle rounded-md cursor-grab transition-all duration-200 hover:border-border-focus mb-2 block ${isActive ? 'active border-accent-primary bg-blue-500/5' : ''}`;
        card.dataset.id = q.id; // Important for Sortable
        
        card.innerHTML = `
            <div class="flex justify-between items-center pointer-events-none">
                <span class="text-xs text-accent-primary font-semibold uppercase tracking-wider">${q.type}</span>
                ${q.mapId ? `<span class="text-[10px] px-1.5 py-0.5 bg-blue-500/10 border border-accent-primary rounded-full text-accent-primary">${mapLabel}</span>` : ''}
            </div>
            <div class="mt-1 pointer-events-none text-sm">${q.text}</div>
        `;

        card.addEventListener('click', () => {
            selectQuestion(q.id);
        });

        els.questionList.appendChild(card);
    });

    if (!sortableInstance && els.questionList) {
        sortableInstance = new Sortable(els.questionList, {
            animation: 150,
            ghostClass: 'sortable-ghost',
            onEnd: function (evt) {
                const itemEl = evt.item; 
                const newIndex = evt.newIndex;
                const oldIndex = evt.oldIndex;

                if (newIndex === oldIndex) return;

                // Reorder array
                const movedItem = state.questions[oldIndex];
                state.questions.splice(oldIndex, 1);
                state.questions.splice(newIndex, 0, movedItem);
                
                // Update order property
                state.questions.forEach((q, idx) => {
                    q.order = idx + 1;
                });

                markSaved('Unsaved changes');
                // No need to re-render full list as Sortable already moved the DOM
            }
        });
    }
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
        } else {
            markSaved('Server save failed');
        }
    } catch (error) {
        markSaved('Server save failed');
    }
}

async function deleteCurrentProject() {
    if (!state.project || !state.project.id) {
        alert('No project selected');
        return;
    }

    const projectName = state.project.name || state.project.id;
    if (!confirm(`Are you sure you want to delete project "${projectName}"?\nThis action cannot be undone.`)) {
        return;
    }

    try {
        const res = await fetch(`/api/projects/${state.project.id}`, { method: 'DELETE' });
        if (res.ok) {
            await loadProjectsList();
            // Reset to default state
            state = JSON.parse(JSON.stringify(defaultState));
            renderProject();
            renderMapCards();
            renderMapDetails();
            renderOverlayList();
            renderQuestions();
            markSaved('Project deleted');
        } else {
            alert('Failed to delete project');
        }
    } catch (err) {
        alert('Error deleting project');
    }
}

function switchTab(tabName) {
    // Update tab buttons
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.tab === tabName) {
            btn.classList.add('active');
        }
    });

    // Update tab panels
    document.querySelectorAll('.tab-panel').forEach(panel => {
        if (panel.dataset.panel === tabName) {
            panel.classList.remove('hidden');
            panel.classList.add('block');
        } else {
            panel.classList.remove('block');
            panel.classList.add('hidden');
        }
    });
}

function initEvents() {
    // Tab switching
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    // Project dropdown
    els.projectDropdown?.addEventListener('change', e => {
        const projectId = e.target.value;
        if (projectId && projectId !== state.project.id) {
            if (!checkUnsavedChanges()) {
                els.projectDropdown.value = state.project.id || '';
                return;
            }
            loadProjectById(projectId);
        }
    });

    // Project actions
    els.newProject?.addEventListener('click', newProject);
    els.deleteProject?.addEventListener('click', deleteCurrentProject);
    els.saveServer?.addEventListener('click', persistStateToServer);
    els.downloadConfig?.addEventListener('click', downloadConfig);
    els.openProject?.addEventListener('click', () => {
        const selected = els.projectDropdown?.value || state.project.id;
        const url = selected ? `/app?project=${encodeURIComponent(selected)}` : '/app';
        window.open(url, '_blank');
    });

    // Project details
    els.projectName.addEventListener('input', e => {
        state.project.name = e.target.value;
        markSaved('Unsaved changes');
        renderProjectDropdown();
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

    els.projectRearProjection?.addEventListener('change', e => {
        state.project.rearProjection = e.target.checked;
        markSaved('Unsaved changes');
    });

    els.projectTuiMode?.addEventListener('change', e => {
        state.project.tuiMode = e.target.checked;
        markSaved('Unsaved changes');
    });

    // Map details
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

    // Overlays
    els.toggleAllOverlays.addEventListener('click', toggleAllOverlays);
    els.addMapBtn.addEventListener('click', addMapFromForm);

    // Questions
    els.addQuestionBtn.addEventListener('click', addDefaultQuestion);
    els.deleteQuestionBtn.addEventListener('click', deleteSelectedQuestion);
    els.questionText.addEventListener('input', updateSelectedQuestion);
    els.questionType.addEventListener('change', () => {
        updateSelectedQuestion();
        renderQuestionDetails();
    });
    els.questionMapPreset.addEventListener('change', updateSelectedQuestion);
    if(els.questionOptions) els.questionOptions.addEventListener('input', updateSelectedQuestion);
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
