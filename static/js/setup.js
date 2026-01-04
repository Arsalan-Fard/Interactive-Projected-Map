const DEFAULT_STICKER_COLORS = [
    '#FF6B6B',
    '#4ECDC4',
    '#45B7D1',
    '#FFA07A',
    '#98D8C8',
    '#F7DC6F',
    '#BB8FCE',
    '#85C1E2',
    '#F8B739',
    '#E74C3C'
];
const MAX_STICKER_COUNT = DEFAULT_STICKER_COLORS.length;
const DEFAULT_TAG_SETTINGS_COUNT = 10;
const MAX_TAG_SETTINGS_COUNT = 50;

const defaultState = {
    project: {
        name: 'Pilot 01',
        location: 'Palaiseau Campus',
        id: 'project-palaiseau',
        mapId: 'palaiseau-outdoor',
        rearProjection: false,
        tuiMode: false,
        workshopMode: false,
        tagSettings: {
            count: DEFAULT_TAG_SETTINGS_COUNT,
            items: []
        },
        tagConfig: null,
        drawingConfig: {
            items: [
                { id: 'drawing-1', label: 'drawing line', color: '#ff00ff', tagId: 6 }
            ]
        },
        stickerConfig: {
            count: MAX_STICKER_COUNT,
            colors: [...DEFAULT_STICKER_COLORS]
        }
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
let responses = [];
let selectedResponseFilenames = new Set();
let selectedQuestionId = null; 
let isSwitching = false; 
let sortableInstance = null;
let responsesRefreshTimer = null;

const els = {
    projectName: document.getElementById('project-name'),
    projectLocation: document.getElementById('project-location'),
    projectId: document.getElementById('project-id'),
    projectPill: document.getElementById('project-pill'),
    projectRearProjection: document.getElementById('project-rear-projection'),
    projectTuiMode: document.getElementById('project-tui-mode'),
    projectWorkshopMode: document.getElementById('workshop-mode'),
    drawingSettingsList: document.getElementById('drawing-settings-list'),
    addDrawingSetting: document.getElementById('add-drawing-setting'),
    stickerCount: document.getElementById('sticker-count'),
    stickerColors: document.getElementById('sticker-colors'),
    tagSettingsCount: document.getElementById('tag-count'),
    tagSettingsLabels: document.getElementById('tag-labels'),
    tagConfig: document.getElementById('tag-config'),
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
    responsesList: document.getElementById('responses-list'),
    uploadResponsesBtn: document.getElementById('upload-responses'),
    uploadResponsesInput: document.getElementById('upload-responses-input'),
    responsesSelectAll: document.getElementById('responses-select-all'),
    responsesViewSelected: document.getElementById('responses-view-selected'),
    responsesDeleteSelected: document.getElementById('responses-delete-selected'),
    responsesFilterStart: document.getElementById('responses-filter-start'),
    responsesFilterEnd: document.getElementById('responses-filter-end'),
};

const TAG_ID_OPTIONS = Array.from({ length: 43 }, (_, i) => i + 7);
const TAG_SETTINGS_ID_OPTIONS = Array.from({ length: 50 }, (_, i) => i);
const TAG_IMAGE_PREFIX = '/generated_tags/tag36h11_id';
const DEFAULT_DRAWING_CONFIG = {
    items: [
        { id: 'drawing-1', label: 'drawing line', color: '#ff00ff', tagId: 6 }
    ]
};
const DEFAULT_DRAWING_ITEM = DEFAULT_DRAWING_CONFIG.items[0];
const DRAWING_TAG_ID_OPTIONS = Array.from(new Set([DEFAULT_DRAWING_ITEM.tagId, ...TAG_ID_OPTIONS])).sort((a, b) => a - b);
const DEFAULT_TAG_GROUPS = {
    reach15: [
        { id: 'walk', label: 'Walk', enabled: true, tagId: null },
        { id: 'bike', label: 'Cycling', enabled: true, tagId: null },
        { id: 'car', label: 'Car', enabled: false, tagId: null }
    ],
    shortestPath: [
        { id: 'A', label: 'Point A', enabled: true, tagId: null },
        { id: 'B', label: 'Point B', enabled: true, tagId: null }
    ],
    tools: [
        { id: 'eraser', label: 'Eraser', enabled: true, tagId: null }
    ]
};

function slugify(text) {
    return text
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '')
        .slice(0, 40) || 'item';
}

function getTagImageSrc(tagId) {
    if (!Number.isFinite(tagId)) return '';
    const safeId = Math.max(0, Math.floor(tagId));
    return `${TAG_IMAGE_PREFIX}${String(safeId).padStart(2, '0')}.png`;
}

function mergeTagItems(defaultItems, existingItems) {
    const byId = new Map();
    (existingItems || []).forEach(item => {
        if (item && item.id) {
            byId.set(item.id, item);
        }
    });
    return defaultItems.map(item => {
        const existing = byId.get(item.id) || {};
        return {
            id: item.id,
            label: item.label,
            enabled: existing.enabled ?? item.enabled ?? true,
            tagId: Number.isInteger(existing.tagId)
                ? existing.tagId
                : (Number.isInteger(item.tagId) ? item.tagId : null)
        };
    });
}

function normalizeTagConfig() {
    if (!state.project) return;
    const existing = state.project.tagConfig || {};
    const layerItems = (state.overlays || []).map(layer => {
        const layerConfig = (existing.layers?.items || []).find(item => item.id === layer.id) || {};
        return {
            id: layer.id,
            label: layer.label || layer.id,
            enabled: layerConfig.enabled ?? true,
            tagId: Number.isInteger(layerConfig.tagId) ? layerConfig.tagId : null
        };
    });

    state.project.tagConfig = {
        layers: { items: layerItems },
        reach15: { items: mergeTagItems(DEFAULT_TAG_GROUPS.reach15, existing.reach15?.items) },
        shortestPath: { items: mergeTagItems(DEFAULT_TAG_GROUPS.shortestPath, existing.shortestPath?.items) },
        tools: { items: mergeTagItems(DEFAULT_TAG_GROUPS.tools, existing.tools?.items) }
    };
}

function normalizeDrawingConfig() {
    if (!state.project) return;
    const existing = state.project.drawingConfig;

    let items = [];
    if (Array.isArray(existing)) {
        items = existing;
    } else if (existing && Array.isArray(existing.items)) {
        items = existing.items;
    } else if (existing && (existing.label || existing.color || existing.tagId !== undefined)) {
        items = [existing];
    } else {
        items = DEFAULT_DRAWING_CONFIG.items;
    }

    const normalized = (Array.isArray(items) ? items : []).map((raw, index) => {
        const fallbackId = `drawing-${index + 1}`;
        const id = typeof raw?.id === 'string' && raw.id.trim().length > 0 ? raw.id : fallbackId;
        const label = typeof raw?.label === 'string' && raw.label.trim().length > 0
            ? raw.label
            : DEFAULT_DRAWING_ITEM.label;
        let color = typeof raw?.color === 'string' ? raw.color.trim() : '';
        if (!/^#[0-9a-f]{6}$/i.test(color)) {
            if (color.toLowerCase() === 'magenta' || color.toLowerCase() === 'fuchsia') {
                color = DEFAULT_DRAWING_ITEM.color;
            } else {
                color = DEFAULT_DRAWING_ITEM.color;
            }
        }
        const tagId = Number.isInteger(raw?.tagId) ? raw.tagId : DEFAULT_DRAWING_ITEM.tagId;
        return { id, label, color, tagId };
    });

    if (normalized.length === 0) {
        normalized.push({ ...DEFAULT_DRAWING_ITEM });
    }

    state.project.drawingConfig = { items: normalized };
}

function clampStickerCount(value) {
    if (!Number.isFinite(value)) return 1;
    return Math.max(1, Math.min(MAX_STICKER_COUNT, value));
}

function normalizeStickerConfig() {
    if (!state.project) return;
    const existing = state.project.stickerConfig || {};
    let count = Number.isInteger(existing.count) ? existing.count : null;

    if (!count) {
        if (Array.isArray(existing.colors) && existing.colors.length > 0) {
            count = existing.colors.length;
        } else {
            count = MAX_STICKER_COUNT;
        }
    }

    count = clampStickerCount(count);
    const colors = Array.isArray(existing.colors) ? existing.colors.slice(0, MAX_STICKER_COUNT) : [];
    const tags = Array.isArray(existing.tags) ? existing.tags.slice(0, MAX_STICKER_COUNT) : [];

    while (colors.length < count) {
        const fallback = DEFAULT_STICKER_COLORS[colors.length] || '#cccccc';
        colors.push(fallback);
    }

    while (tags.length < count) {
        tags.push(null);
    }

    state.project.stickerConfig = {
        count,
        colors: colors.slice(0, count),
        tags: tags.slice(0, count)
    };
}

function clampTagSettingsCount(value) {
    if (!Number.isFinite(value)) return 1;
    return Math.max(1, Math.min(MAX_TAG_SETTINGS_COUNT, value));
}

function normalizeTagSettings() {
    if (!state.project) return;
    const existing = state.project.tagSettings || {};
    let count = Number.isInteger(existing.count) ? existing.count : null;
    const rawItems = Array.isArray(existing.items) ? existing.items : [];

    if (!count) {
        count = rawItems.length > 0 ? rawItems.length : DEFAULT_TAG_SETTINGS_COUNT;
    }

    count = clampTagSettingsCount(count);
    const items = rawItems.slice(0, count).map(item => {
        const label = typeof item?.label === 'string' ? item.label.trim() : '';
        const tagId = Number.isInteger(item?.tagId) ? item.tagId : null;
        return { label, tagId };
    });

    while (items.length < count) {
        items.push({ label: '', tagId: null });
    }

    state.project.tagSettings = {
        count,
        items: items.slice(0, count)
    };
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

    normalizeTagConfig();
    normalizeDrawingConfig();
    normalizeStickerConfig();
    normalizeTagSettings();
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

            await loadResponses(projectId);
            markSaved(`Loaded ${projectId}`);
            return;
        }
    } catch (err) {
    }
    responses = [];
    renderResponses();
    markSaved('Failed to load project');
}

function formatResponseTime(value) {
    if (!value) return 'Unknown time';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString();
}

function parseDateInput(value, isEnd = false) {
    if (!value) return null;
    const parts = value.split('-').map(part => Number.parseInt(part, 10));
    if (parts.length !== 3 || parts.some(Number.isNaN)) return null;
    const [year, month, day] = parts;
    if (!year || !month || !day) return null;
    if (isEnd) {
        return new Date(year, month - 1, day, 23, 59, 59, 999);
    }
    return new Date(year, month - 1, day, 0, 0, 0, 0);
}

function getResponseFilterRange() {
    const start = parseDateInput(els.responsesFilterStart?.value || '');
    const end = parseDateInput(els.responsesFilterEnd?.value || '', true);
    return { start, end };
}

function isResponseFilterActive(range) {
    return Boolean(range?.start || range?.end);
}

function getFilteredResponses() {
    const range = getResponseFilterRange();
    if (!isResponseFilterActive(range)) return responses;
    return responses.filter(response => {
        if (!response || !response.savedAt) return false;
        const date = new Date(response.savedAt);
        if (Number.isNaN(date.getTime())) return false;
        if (range.start && date < range.start) return false;
        if (range.end && date > range.end) return false;
        return true;
    });
}

function formatResponseFilename(response) {
    if (response && response.__filename) return response.__filename;
    if (!response || !response.savedAt) return 'responses.json';
    const safeTimestamp = String(response.savedAt).replace(/[:.]/g, '-');
    return `responses_${safeTimestamp}.json`;
}

function getResponseFilename(response) {
    return response && response.__filename ? response.__filename : formatResponseFilename(response);
}

function downloadResponse(response) {
    if (!response) return;
    const filename = getResponseFilename(response);
    const copy = { ...response };
    delete copy.__filename;
    const blob = new Blob([JSON.stringify(copy, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

function viewResponse(response) {
    if (!response) return;
    const copy = { ...response };
    delete copy.__filename;
    const blob = new Blob([JSON.stringify(copy, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const opened = window.open(url, '_blank');
    if (!opened) {
        alert('Popup blocked. Please allow popups to view the response.');
    }
    setTimeout(() => URL.revokeObjectURL(url), 10000);
}

async function deleteResponse(filename, { skipConfirm = false } = {}) {
    if (!filename) return false;
    const projectId = state.project?.id;
    if (!projectId) {
        alert('No project selected.');
        return false;
    }
    if (!skipConfirm && !confirm(`Delete response "${filename}"? This cannot be undone.`)) {
        return false;
    }
    try {
        const res = await fetch(`/api/responses?project=${encodeURIComponent(projectId)}&filename=${encodeURIComponent(filename)}`, {
            method: 'DELETE'
        });
        if (!res.ok) {
            alert('Failed to delete response.');
            return false;
        }
        return true;
    } catch (err) {
        alert('Failed to delete response.');
        return false;
    }
}

function updateResponsesSelectionUI(visibleResponses) {
    const list = Array.isArray(visibleResponses) ? visibleResponses : getFilteredResponses();
    const total = list.length;
    const selectedCount = list.filter(response =>
        selectedResponseFilenames.has(getResponseFilename(response))
    ).length;
    const allSelected = total > 0 && selectedCount === total;
    const hasSelection = selectedCount > 0;

    if (els.responsesSelectAll) {
        els.responsesSelectAll.textContent = allSelected ? 'Deselect All' : 'Select All';
        els.responsesSelectAll.disabled = total === 0;
        els.responsesSelectAll.classList.toggle('opacity-50', total === 0);
        els.responsesSelectAll.classList.toggle('cursor-not-allowed', total === 0);
    }
    if (els.responsesViewSelected) {
        els.responsesViewSelected.disabled = !hasSelection;
        els.responsesViewSelected.classList.toggle('opacity-50', !hasSelection);
        els.responsesViewSelected.classList.toggle('cursor-not-allowed', !hasSelection);
    }
    if (els.responsesDeleteSelected) {
        els.responsesDeleteSelected.disabled = !hasSelection;
        els.responsesDeleteSelected.classList.toggle('opacity-50', !hasSelection);
        els.responsesDeleteSelected.classList.toggle('cursor-not-allowed', !hasSelection);
    }
}

function renderResponses() {
    if (!els.responsesList) return;
    els.responsesList.innerHTML = '';

    if (!responses.length) {
        selectedResponseFilenames.clear();
        const empty = document.createElement('div');
        empty.className = 'text-xs text-text-muted italic';
        empty.textContent = 'No responses saved yet.';
        els.responsesList.appendChild(empty);
        updateResponsesSelectionUI([]);
        return;
    }

    const existingFilenames = new Set(responses.map(getResponseFilename));
    selectedResponseFilenames = new Set(
        Array.from(selectedResponseFilenames).filter(name => existingFilenames.has(name))
    );

    const range = getResponseFilterRange();
    const filterActive = isResponseFilterActive(range);
    const filteredResponses = filterActive ? getFilteredResponses() : responses;
    if (filterActive) {
        const filteredFilenames = new Set(filteredResponses.map(getResponseFilename));
        selectedResponseFilenames = new Set(
            Array.from(selectedResponseFilenames).filter(name => filteredFilenames.has(name))
        );
    }

    if (!filteredResponses.length) {
        const empty = document.createElement('div');
        empty.className = 'text-xs text-text-muted italic';
        empty.textContent = filterActive ? 'No responses in this date range.' : 'No responses saved yet.';
        els.responsesList.appendChild(empty);
        updateResponsesSelectionUI(filteredResponses);
        return;
    }

    filteredResponses.forEach(response => {
        const row = document.createElement('div');
        row.className = 'flex items-center justify-between px-3 py-2 bg-bg-tertiary border border-border-subtle rounded-md text-text-secondary';

        const left = document.createElement('div');
        left.className = 'flex items-start gap-3';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'mt-1 w-[16px] h-[16px] cursor-pointer accent-accent-primary';
        const filename = getResponseFilename(response);
        checkbox.checked = selectedResponseFilenames.has(filename);
        checkbox.addEventListener('change', () => {
            if (checkbox.checked) {
                selectedResponseFilenames.add(filename);
            } else {
                selectedResponseFilenames.delete(filename);
            }
            updateResponsesSelectionUI();
        });

        const textWrap = document.createElement('div');
        textWrap.className = 'flex flex-col';
        const time = document.createElement('span');
        time.className = 'text-text-primary text-sm font-medium';
        time.textContent = formatResponseTime(response.savedAt);
        const filenameText = document.createElement('span');
        filenameText.className = 'text-[11px] text-text-muted';
        filenameText.textContent = filename;
        textWrap.appendChild(time);
        textWrap.appendChild(filenameText);
        left.appendChild(checkbox);
        left.appendChild(textWrap);

        const actions = document.createElement('div');
        actions.className = 'flex items-center gap-2';

        const downloadBtn = document.createElement('button');
        downloadBtn.type = 'button';
        downloadBtn.className = 'px-2.5 py-1 text-[11px] border border-border-subtle rounded-md text-text-secondary hover:text-text-primary hover:border-border-focus';
        downloadBtn.textContent = 'Download';
        downloadBtn.addEventListener('click', () => downloadResponse(response));

        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'px-2.5 py-1 text-[11px] border border-border-subtle rounded-md text-accent-danger hover:text-white hover:bg-accent-danger hover:border-accent-danger';
        deleteBtn.textContent = 'Delete';
        deleteBtn.addEventListener('click', async () => {
            const ok = await deleteResponse(filename);
            if (ok) {
                selectedResponseFilenames.delete(filename);
                loadResponses(state.project?.id);
            }
        });

        actions.appendChild(downloadBtn);
        actions.appendChild(deleteBtn);

        row.appendChild(left);
        row.appendChild(actions);
        els.responsesList.appendChild(row);
    });

    updateResponsesSelectionUI(filteredResponses);
}

async function loadResponses(projectId) {
    if (!els.responsesList) return;
    if (!projectId) {
        responses = [];
        renderResponses();
        return;
    }
    try {
        const res = await fetch(`/api/responses?project=${encodeURIComponent(projectId)}`);
        if (res.ok) {
            const data = await res.json();
            responses = Array.isArray(data.responses) ? data.responses : [];
        } else {
            responses = [];
        }
    } catch (err) {
        responses = [];
    }
    renderResponses();
}

function scheduleResponsesRefresh() {
    if (responsesRefreshTimer) {
        clearTimeout(responsesRefreshTimer);
    }
    responsesRefreshTimer = setTimeout(() => {
        loadResponses(state.project?.id);
    }, 300);
}

function toggleSelectAllResponses() {
    const filteredResponses = getFilteredResponses();
    if (!filteredResponses.length) return;
    const allSelected = filteredResponses.every(response =>
        selectedResponseFilenames.has(getResponseFilename(response))
    );
    if (allSelected) {
        filteredResponses.forEach(response => {
            selectedResponseFilenames.delete(getResponseFilename(response));
        });
    } else {
        filteredResponses.forEach(response => {
            selectedResponseFilenames.add(getResponseFilename(response));
        });
    }
    renderResponses();
}

function viewSelectedResponses() {
    const selected = responses.filter(r => selectedResponseFilenames.has(getResponseFilename(r)));
    if (selected.length === 0) {
        alert('No responses selected.');
        return;
    }
    const projectId = state.project?.id;
    const params = new URLSearchParams();
    if (projectId) params.set('project', projectId);
    selected.forEach(response => {
        const filename = getResponseFilename(response);
        if (filename) params.append('response', filename);
    });
    window.open(`/results?${params.toString()}`, '_blank');
}

async function deleteSelectedResponses() {
    const selected = responses.filter(r => selectedResponseFilenames.has(getResponseFilename(r)));
    if (selected.length === 0) {
        alert('No responses selected.');
        return;
    }
    const countLabel = selected.length === 1 ? 'this response' : `${selected.length} responses`;
    if (!confirm(`Delete ${countLabel}? This cannot be undone.`)) {
        return;
    }
    for (const response of selected) {
        const filename = getResponseFilename(response);
        // Best-effort deletes; continue through failures.
        await deleteResponse(filename, { skipConfirm: true });
        selectedResponseFilenames.delete(filename);
    }
    loadResponses(state.project?.id);
}

async function uploadResponsesFile(file) {
    if (!file) return;
    const projectId = state.project?.id;
    if (!projectId) {
        alert('No project selected.');
        return;
    }
    if (!file.name.toLowerCase().endsWith('.json')) {
        alert('Please upload a JSON file.');
        return;
    }

    try {
        const text = await file.text();
        const data = JSON.parse(text);
        if (!data || data.projectId !== projectId) {
            alert(`Project ID mismatch. Expected "${projectId}".`);
            return;
        }

        const res = await fetch('/api/save_responses', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                responses: data,
                filename: file.name,
                projectId
            })
        });

        if (!res.ok) {
            alert('Failed to upload responses.');
            return;
        }
        await loadResponses(projectId);
    } catch (err) {
        alert('Failed to upload responses.');
    }
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

    normalizeTagConfig();

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
    loadResponses(state.project.id);

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
    if (els.projectWorkshopMode) {
        els.projectWorkshopMode.checked = !!state.project.workshopMode;
    }
    renderDrawingConfig();
    renderStickerConfig();
    renderTagSettings();
    renderTagConfig();
}

function getAllDrawingTagIds() {
    const items = state.project?.drawingConfig?.items;
    if (!Array.isArray(items)) return [];
    return items
        .map(item => item?.tagId)
        .filter(tagId => Number.isInteger(tagId));
}

function renderDrawingConfig() {
    if (!els.drawingSettingsList) return;
    normalizeDrawingConfig();
    const items = state.project.drawingConfig?.items || DEFAULT_DRAWING_CONFIG.items;

    const usedTags = new Set();
    const stickerTags = state.project.stickerConfig?.tags || [];
    stickerTags.forEach(tagId => {
        if (Number.isInteger(tagId)) usedTags.add(String(tagId));
    });
    const tagConfig = state.project.tagConfig || {};
    (tagConfig.layers?.items || []).forEach(item => {
        if (Number.isInteger(item.tagId)) usedTags.add(String(item.tagId));
    });
    (tagConfig.reach15?.items || []).forEach(item => {
        if (Number.isInteger(item.tagId)) usedTags.add(String(item.tagId));
    });
    (tagConfig.shortestPath?.items || []).forEach(item => {
        if (Number.isInteger(item.tagId)) usedTags.add(String(item.tagId));
    });
    (tagConfig.tools?.items || []).forEach(item => {
        if (Number.isInteger(item.tagId)) usedTags.add(String(item.tagId));
    });

    els.drawingSettingsList.innerHTML = '';

    const drawingTagOwner = new Map();
    items.forEach((item, index) => {
        if (!Number.isInteger(item?.tagId)) return;
        const key = String(item.tagId);
        if (!drawingTagOwner.has(key)) {
            drawingTagOwner.set(key, index);
        }
    });

    items.forEach((item, index) => {
        const row = document.createElement('div');
        row.className = 'flex flex-col lg:flex-row lg:items-end gap-3 p-3 bg-bg-tertiary border border-border-subtle rounded-md';

        const nameWrap = document.createElement('div');
        nameWrap.className = 'flex flex-col gap-1 flex-1 min-w-[180px]';
        const nameLabel = document.createElement('label');
        nameLabel.className = 'text-[11px] text-text-muted uppercase tracking-wider';
        nameLabel.textContent = 'Name';
        const nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.value = item.label || DEFAULT_DRAWING_ITEM.label;
        nameInput.className = 'w-full h-10 px-3 bg-bg-secondary border border-border-subtle rounded-md text-text-primary text-sm transition-colors duration-200 font-inherit hover:border-border-focus focus:outline-none focus:border-accent-primary';
        nameInput.addEventListener('input', (e) => {
            state.project.drawingConfig.items[index].label = e.target.value;
            markSaved('Unsaved changes');
        });
        nameWrap.appendChild(nameLabel);
        nameWrap.appendChild(nameInput);

        const colorWrap = document.createElement('div');
        colorWrap.className = 'flex flex-col gap-1 lg:min-w-[160px]';
        const colorLabel = document.createElement('label');
        colorLabel.className = 'text-[11px] text-text-muted uppercase tracking-wider';
        colorLabel.textContent = 'Color';
        const colorInput = document.createElement('input');
        colorInput.type = 'color';
        colorInput.value = item.color || DEFAULT_DRAWING_ITEM.color;
        colorInput.className = 'w-full h-10 px-2 bg-bg-secondary border border-border-subtle rounded-md text-text-primary text-sm transition-colors duration-200 font-inherit hover:border-border-focus focus:outline-none focus:border-accent-primary';
        colorInput.addEventListener('input', (e) => {
            state.project.drawingConfig.items[index].color = e.target.value;
            markSaved('Unsaved changes');
        });
        colorWrap.appendChild(colorLabel);
        colorWrap.appendChild(colorInput);

        const tagWrap = document.createElement('div');
        tagWrap.className = 'flex flex-col gap-1 lg:min-w-[160px]';
        const tagLabel = document.createElement('label');
        tagLabel.className = 'text-[11px] text-text-muted uppercase tracking-wider';
        tagLabel.textContent = 'AprilTag ID';
        const tagSelect = document.createElement('select');
        tagSelect.className = 'w-full h-10 px-3 bg-bg-secondary border border-border-subtle rounded-md text-text-primary text-sm transition-colors duration-200 font-inherit hover:border-border-focus focus:outline-none focus:border-accent-primary';

        const currentTag = Number.isInteger(item.tagId) ? String(item.tagId) : '';

        DRAWING_TAG_ID_OPTIONS.forEach(tagId => {
            const option = document.createElement('option');
            option.value = String(tagId);
            option.textContent = `ID ${tagId}`;

            const ownerIndex = drawingTagOwner.get(option.value);
            const usedByOtherDrawing = ownerIndex !== undefined && ownerIndex !== index;
            const isUsed = usedTags.has(option.value) || usedByOtherDrawing;
            if (isUsed) {
                option.disabled = true;
                option.textContent = `ID ${tagId} (in use)`;
            }

            tagSelect.appendChild(option);
        });

        const desired = currentTag || String(DEFAULT_DRAWING_ITEM.tagId);
        const available = tagSelect.querySelector(`option[value="${desired}"]`);
        if (available && !available.disabled) {
            tagSelect.value = desired;
            state.project.drawingConfig.items[index].tagId = Number.parseInt(desired, 10);
        } else {
            const firstAvailable = Array.from(tagSelect.options).find(opt => !opt.disabled) || null;
            if (firstAvailable) {
                tagSelect.value = firstAvailable.value;
                state.project.drawingConfig.items[index].tagId = Number.parseInt(firstAvailable.value, 10);
            }
        }

        tagSelect.addEventListener('change', (e) => {
            const next = Number.parseInt(e.target.value, 10);
            state.project.drawingConfig.items[index].tagId = Number.isFinite(next) ? next : DEFAULT_DRAWING_ITEM.tagId;
            renderDrawingConfig();
            renderStickerConfig();
            renderTagConfig();
            markSaved('Unsaved changes');
        });

        tagWrap.appendChild(tagLabel);
        tagWrap.appendChild(tagSelect);

        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'h-10 px-3 text-[12px] border border-border-subtle rounded-md text-accent-danger hover:text-white hover:bg-accent-danger hover:border-accent-danger disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-accent-danger';
        deleteBtn.textContent = 'Delete';
        deleteBtn.disabled = items.length <= 1;
        deleteBtn.addEventListener('click', () => {
            if (state.project.drawingConfig.items.length <= 1) return;
            state.project.drawingConfig.items.splice(index, 1);
            normalizeDrawingConfig();
            renderDrawingConfig();
            renderStickerConfig();
            renderTagConfig();
            markSaved('Unsaved changes');
        });

        row.appendChild(nameWrap);
        row.appendChild(colorWrap);
        row.appendChild(tagWrap);
        row.appendChild(deleteBtn);
        els.drawingSettingsList.appendChild(row);
    });
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

function updateStickerCount(nextCount) {
    normalizeStickerConfig();
    const config = state.project.stickerConfig || {};
    const count = clampStickerCount(nextCount);
    const colors = Array.isArray(config.colors) ? config.colors.slice(0, count) : [];
    while (colors.length < count) {
        const fallback = DEFAULT_STICKER_COLORS[colors.length] || '#cccccc';
        colors.push(fallback);
    }
    state.project.stickerConfig = { count, colors };
}

function updateTagSettingsCount(nextCount) {
    normalizeTagSettings();
    const count = clampTagSettingsCount(nextCount);
    const items = Array.isArray(state.project.tagSettings.items) ? state.project.tagSettings.items.slice(0, count) : [];
    while (items.length < count) {
        items.push({ label: '', tagId: null });
    }
    state.project.tagSettings = { count, items: items.slice(0, count) };
}

function renderStickerConfig() {
    if (!els.stickerCount || !els.stickerColors) return;
    normalizeStickerConfig();
    const config = state.project.stickerConfig || { count: 0, colors: [], tags: [] };
    const count = clampStickerCount(config.count);
    const colors = Array.isArray(config.colors) ? config.colors.slice(0, count) : [];
    const tags = Array.isArray(config.tags) ? config.tags : [];

    // Ensure tags array matches count
    while (tags.length < count) {
        tags.push(null);
    }
    state.project.stickerConfig.tags = tags.slice(0, count);

    els.stickerCount.value = count;
    els.stickerColors.innerHTML = '';

    const tagSelects = [];

    // Collect all tags used in other configurations
    const getUsedTagsFromOtherConfigs = () => {
        const usedTags = new Set();
        const tagConfig = state.project.tagConfig || {};

        // Collect from layers
        (tagConfig.layers?.items || []).forEach(item => {
            if (Number.isInteger(item.tagId)) {
                usedTags.add(String(item.tagId));
            }
        });

        // Collect from reach15
        (tagConfig.reach15?.items || []).forEach(item => {
            if (Number.isInteger(item.tagId)) {
                usedTags.add(String(item.tagId));
            }
        });

        // Collect from shortestPath
        (tagConfig.shortestPath?.items || []).forEach(item => {
            if (Number.isInteger(item.tagId)) {
                usedTags.add(String(item.tagId));
            }
        });

        // Collect from tools
        (tagConfig.tools?.items || []).forEach(item => {
            if (Number.isInteger(item.tagId)) {
                usedTags.add(String(item.tagId));
            }
        });

        getAllDrawingTagIds().forEach(tagId => usedTags.add(String(tagId)));

        return usedTags;
    };

    const updateTagSelects = () => {
        const usedInOtherConfigs = getUsedTagsFromOtherConfigs();
        const counts = new Map();

        tagSelects.forEach(select => {
            const value = select.value;
            if (!value) return;
            counts.set(value, (counts.get(value) || 0) + 1);
        });

        tagSelects.forEach(select => {
            const current = select.value;
            Array.from(select.options).forEach(option => {
                if (!option.value) return;
                const usedInStickers = counts.get(option.value) || 0;
                const selectedElsewhere = option.value !== current && usedInStickers > 0;
                const usedInOtherConfig = usedInOtherConfigs.has(option.value);
                option.disabled = selectedElsewhere || usedInOtherConfig;
            });
        });
    };

    colors.forEach((color, index) => {
        const wrapper = document.createElement('div');
        wrapper.className = 'flex flex-col gap-2';

        // Color swatch row
        const swatchRow = document.createElement('div');
        swatchRow.className = 'relative';

        const swatch = document.createElement('button');
        swatch.type = 'button';
        swatch.className = 'w-9 h-9 rounded-full border border-border-subtle shadow-inner cursor-pointer transition-transform duration-200 hover:scale-105';
        swatch.style.backgroundColor = color;
        swatch.title = `Sticker ${index + 1} color`;

        const picker = document.createElement('input');
        picker.type = 'color';
        picker.value = color;
        picker.className = 'absolute opacity-0 pointer-events-none w-0 h-0';

        swatch.addEventListener('click', () => {
            picker.click();
        });

        picker.addEventListener('input', () => {
            const nextColor = picker.value;
            state.project.stickerConfig.colors[index] = nextColor;
            swatch.style.backgroundColor = nextColor;
            markSaved('Unsaved changes');
        });

        swatchRow.appendChild(swatch);
        swatchRow.appendChild(picker);

        // Tag selector row
        const tagRow = document.createElement('div');
        tagRow.className = 'flex items-center gap-2';

        const select = document.createElement('select');
        select.className = 'h-9 px-3 bg-bg-secondary border border-border-subtle rounded-md text-text-primary text-xs cursor-pointer transition-colors duration-200 hover:border-border-focus focus:outline-none focus:border-accent-primary';

        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = 'Select tag ID';
        select.appendChild(placeholder);

        TAG_ID_OPTIONS.forEach(tagId => {
            const option = document.createElement('option');
            option.value = String(tagId);
            option.textContent = `ID ${tagId}`;
            select.appendChild(option);
        });

        const currentTag = tags[index];
        if (Number.isInteger(currentTag)) {
            select.value = String(currentTag);
        } else {
            select.value = '';
        }
        tagSelects.push(select);

        tagRow.appendChild(select);

        // Tag preview row
        const preview = document.createElement('div');
        preview.className = 'w-[56px] h-[56px] bg-bg-secondary border border-border-subtle rounded-md flex items-center justify-center overflow-hidden';
        const img = document.createElement('img');
        img.className = 'w-full h-full object-contain';
        img.alt = `Sticker ${index + 1} tag`;
        const placeholderText = document.createElement('span');
        placeholderText.className = 'text-[9px] text-text-muted uppercase tracking-wider';
        placeholderText.textContent = 'No tag';

        preview.appendChild(img);
        preview.appendChild(placeholderText);

        const updatePreview = () => {
            const tagValue = state.project.stickerConfig.tags[index];
            if (Number.isInteger(tagValue)) {
                img.src = getTagImageSrc(tagValue);
                img.style.display = 'block';
                placeholderText.style.display = 'none';
            } else {
                img.src = '';
                img.style.display = 'none';
                placeholderText.style.display = 'block';
            }
        };

        updatePreview();

        select.addEventListener('change', () => {
            state.project.stickerConfig.tags[index] = select.value === '' ? null : Number.parseInt(select.value, 10);
            markSaved('Unsaved changes');
            updatePreview();
            updateTagSelects();
            renderTagConfig(); // Update layer/reach15/shortestPath tag selects
        });

        wrapper.appendChild(swatchRow);
        wrapper.appendChild(tagRow);
        wrapper.appendChild(preview);
        els.stickerColors.appendChild(wrapper);
    });

    updateTagSelects();
}

function renderTagSettings() {
    if (!els.tagSettingsCount || !els.tagSettingsLabels) return;
    normalizeTagSettings();
    const config = state.project.tagSettings || { count: 0, items: [] };
    const count = clampTagSettingsCount(config.count);
    const items = Array.isArray(config.items) ? config.items.slice(0, count) : [];

    while (items.length < count) {
        items.push({ label: '', tagId: null });
    }
    state.project.tagSettings.items = items.slice(0, count);

    els.tagSettingsCount.value = count;
    els.tagSettingsLabels.innerHTML = '';

    items.forEach((item, index) => {
        const wrapper = document.createElement('div');
        wrapper.className = 'flex flex-col gap-2 w-full sm:w-[240px]';

        const labelInput = document.createElement('input');
        labelInput.type = 'text';
        labelInput.value = item.label || '';
        labelInput.placeholder = `Label ${index + 1}`;
        labelInput.className = 'w-full h-10 px-3 bg-bg-tertiary border border-border-subtle rounded-md text-text-primary text-sm transition-colors duration-200 font-inherit hover:border-border-focus focus:outline-none focus:border-accent-primary';
        labelInput.addEventListener('input', (e) => {
            state.project.tagSettings.items[index].label = e.target.value;
            markSaved('Unsaved changes');
        });

        const select = document.createElement('select');
        select.className = 'w-full h-10 px-3 bg-bg-tertiary border border-border-subtle rounded-md text-text-primary text-sm cursor-pointer transition-colors duration-200 hover:border-border-focus focus:outline-none focus:border-accent-primary';

        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = 'Select AprilTag ID';
        select.appendChild(placeholder);

        TAG_SETTINGS_ID_OPTIONS.forEach(tagId => {
            const option = document.createElement('option');
            option.value = String(tagId);
            option.textContent = `ID ${tagId}`;
            select.appendChild(option);
        });

        if (Number.isInteger(item.tagId)) {
            select.value = String(item.tagId);
        } else {
            select.value = '';
        }

        select.addEventListener('change', () => {
            const next = Number.parseInt(select.value, 10);
            state.project.tagSettings.items[index].tagId = Number.isFinite(next) ? next : null;
            markSaved('Unsaved changes');
        });

        const preview = document.createElement('div');
        preview.className = 'w-[56px] h-[56px] bg-bg-tertiary border border-border-subtle rounded-md flex items-center justify-center overflow-hidden';
        const img = document.createElement('img');
        img.className = 'w-full h-full object-contain';
        img.alt = item.label ? `${item.label} tag` : `Tag ${index + 1}`;
        const placeholderText = document.createElement('span');
        placeholderText.className = 'text-[9px] text-text-muted uppercase tracking-wider';
        placeholderText.textContent = 'No tag';
        preview.appendChild(img);
        preview.appendChild(placeholderText);

        const updatePreview = () => {
            const tagValue = state.project.tagSettings.items[index].tagId;
            if (Number.isInteger(tagValue)) {
                img.src = getTagImageSrc(tagValue);
                img.style.display = 'block';
                placeholderText.style.display = 'none';
            } else {
                img.src = '';
                img.style.display = 'none';
                placeholderText.style.display = 'block';
            }
        };

        updatePreview();

        select.addEventListener('change', updatePreview);
        labelInput.addEventListener('input', () => {
            img.alt = labelInput.value ? `${labelInput.value} tag` : `Tag ${index + 1}`;
        });

        wrapper.appendChild(labelInput);
        wrapper.appendChild(select);
        wrapper.appendChild(preview);
        els.tagSettingsLabels.appendChild(wrapper);
    });
}

function renderTagConfig() {
    if (!els.tagConfig) return;
    normalizeTagConfig();
    const config = state.project.tagConfig || {};
    els.tagConfig.innerHTML = '';
    const tagSelects = [];

    const updateTagSelects = () => {
        const counts = new Map();
        tagSelects.forEach(select => {
            const value = select.value;
            if (!value) return;
            counts.set(value, (counts.get(value) || 0) + 1);
        });

        // Collect tags used in sticker config
        const usedInStickers = new Set();
        const stickerTags = state.project.stickerConfig?.tags || [];
        stickerTags.forEach(tagId => {
            if (Number.isInteger(tagId)) {
                usedInStickers.add(String(tagId));
            }
        });
        getAllDrawingTagIds().forEach(tagId => usedInStickers.add(String(tagId)));

        tagSelects.forEach(select => {
            const current = select.value;
            Array.from(select.options).forEach(option => {
                if (!option.value) return;
                const count = counts.get(option.value) || 0;
                const selectedElsewhere = option.value !== current && count > 0;
                const usedInStickerConfig = usedInStickers.has(option.value);
                option.disabled = selectedElsewhere || usedInStickerConfig;
            });
        });
    };

    const groups = [
        {
            key: 'layers',
            title: 'Layers',
            description: 'Toggle layers and assign tags for each overlay.'
        },
        {
            key: 'reach15',
            title: '15-Minute Reach',
            description: 'Assign tags for walk, bike, or car reach tools.'
        },
        {
            key: 'shortestPath',
            title: 'Shortest Path',
            description: 'Assign tags for points A and B.'
        },
        {
            key: 'tools',
            title: 'Tools',
            description: 'Assign tags for drawing tools like the eraser.'
        }
    ];

    groups.forEach(group => {
        const wrapper = document.createElement('div');
        wrapper.className = 'tag-group flex flex-col gap-3';

        const header = document.createElement('div');
        header.className = 'flex items-start justify-between';
        header.innerHTML = `
            <div>
                <h4 class="text-xs font-semibold uppercase tracking-wider text-text-secondary m-0">${group.title}</h4>
                <p class="text-[11px] text-text-muted m-0 mt-1">${group.description}</p>
            </div>
        `;

        const list = document.createElement('div');
        list.className = 'flex flex-col gap-3';

        const items = config[group.key]?.items || [];
        if (items.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'text-xs text-text-muted italic';
            empty.textContent = 'No items available.';
            list.appendChild(empty);
        } else if (group.key === 'shortestPath') {
            const pairedItems = ['A', 'B']
                .map(id => items.find(item => item.id === id))
                .filter(Boolean);

            if (pairedItems.length === 0) {
                const empty = document.createElement('div');
                empty.className = 'text-xs text-text-muted italic';
                empty.textContent = 'No items available.';
                list.appendChild(empty);
            } else {
                const row = document.createElement('div');
                row.className = 'tag-item flex flex-col lg:flex-row lg:items-center gap-3 p-3 bg-bg-tertiary border border-border-subtle rounded-md';

                const labelWrap = document.createElement('div');
                labelWrap.className = 'flex-1 min-w-0';
                const label = document.createElement('div');
                label.className = 'text-sm font-semibold text-text-primary';
                label.textContent = 'Points A and B';
                labelWrap.appendChild(label);

                const meta = document.createElement('div');
                meta.className = 'text-xs text-text-secondary';
                meta.textContent = pairedItems.map(item => item.id).join(' / ');
                labelWrap.appendChild(meta);

                const toggleWrap = document.createElement('label');
                toggleWrap.className = 'flex items-center gap-2 text-xs text-text-secondary';
                const toggle = document.createElement('input');
                toggle.type = 'checkbox';
                toggle.className = 'w-4 h-4 bg-bg-secondary border border-border-subtle rounded cursor-pointer accent-accent-primary';
                toggle.checked = pairedItems.every(item => item.enabled !== false);
                toggleWrap.appendChild(toggle);
                toggleWrap.appendChild(document.createTextNode('Active'));

                const selectWrap = document.createElement('div');
                selectWrap.className = 'flex flex-wrap items-center gap-3';

                const previewUpdates = [];

                const addTagSelector = (item, shortLabel) => {
                    const controlWrap = document.createElement('div');
                    controlWrap.className = 'flex items-center gap-2';

                    const shortLabelEl = document.createElement('span');
                    shortLabelEl.className = 'text-[10px] uppercase tracking-wider text-text-muted font-semibold';
                    shortLabelEl.textContent = shortLabel;

                    const select = document.createElement('select');
                    select.className = 'h-9 px-3 bg-bg-secondary border border-border-subtle rounded-md text-text-primary text-xs cursor-pointer transition-colors duration-200 hover:border-border-focus focus:outline-none focus:border-accent-primary';

                    const placeholder = document.createElement('option');
                    placeholder.value = '';
                    placeholder.textContent = 'Select tag ID';
                    select.appendChild(placeholder);

                    TAG_ID_OPTIONS.forEach(tagId => {
                        const option = document.createElement('option');
                        option.value = String(tagId);
                        option.textContent = `ID ${tagId}`;
                        select.appendChild(option);
                    });

                    if (Number.isInteger(item.tagId)) {
                        select.value = String(item.tagId);
                    } else {
                        select.value = '';
                    }
                    tagSelects.push(select);

                    const preview = document.createElement('div');
                    preview.className = 'w-[56px] h-[56px] bg-bg-secondary border border-border-subtle rounded-md flex items-center justify-center overflow-hidden';
                    const img = document.createElement('img');
                    img.className = 'w-full h-full object-contain';
                    img.alt = item.label ? `${item.label} tag` : 'Tag preview';
                    const placeholderText = document.createElement('span');
                    placeholderText.className = 'text-[9px] text-text-muted uppercase tracking-wider';
                    placeholderText.textContent = 'No tag';

                    preview.appendChild(img);
                    preview.appendChild(placeholderText);

                    const updatePreview = () => {
                        const tagValue = Number.isInteger(item.tagId) ? item.tagId : null;
                        if (tagValue === null) {
                            img.src = '';
                            img.style.display = 'none';
                            placeholderText.style.display = 'block';
                        } else {
                            img.src = getTagImageSrc(tagValue);
                            img.style.display = 'block';
                            placeholderText.style.display = 'none';
                        }
                        const disabled = !toggle.checked;
                        select.disabled = disabled;
                        preview.classList.toggle('opacity-40', disabled);
                    };

                    updatePreview();
                    previewUpdates.push(updatePreview);

                    select.addEventListener('change', () => {
                        item.tagId = select.value === '' ? null : Number.parseInt(select.value, 10);
                        markSaved('Unsaved changes');
                        updatePreview();
                        updateTagSelects();
                        renderStickerConfig(); // Update sticker tag selects
                    });

                    controlWrap.appendChild(shortLabelEl);
                    controlWrap.appendChild(select);
                    controlWrap.appendChild(preview);
                    selectWrap.appendChild(controlWrap);
                };

                pairedItems.forEach(item => addTagSelector(item, item.id || item.label || 'Tag'));

                toggle.addEventListener('change', () => {
                    const enabled = toggle.checked;
                    pairedItems.forEach(item => {
                        item.enabled = enabled;
                    });
                    markSaved('Unsaved changes');
                    previewUpdates.forEach(update => update());
                });

                row.appendChild(labelWrap);
                row.appendChild(toggleWrap);
                row.appendChild(selectWrap);
                list.appendChild(row);
            }
        } else {
            items.forEach(item => {
                const row = document.createElement('div');
                row.className = 'tag-item flex flex-col lg:flex-row lg:items-center gap-3 p-3 bg-bg-tertiary border border-border-subtle rounded-md';

                const labelWrap = document.createElement('div');
                labelWrap.className = 'flex-1 min-w-0';
                const label = document.createElement('div');
                label.className = 'text-sm font-semibold text-text-primary';
                label.textContent = item.label || item.id;
                labelWrap.appendChild(label);

                if (item.id) {
                    const meta = document.createElement('div');
                    meta.className = 'text-xs text-text-secondary';
                    meta.textContent = item.id;
                    labelWrap.appendChild(meta);
                }

                const toggleWrap = document.createElement('label');
                toggleWrap.className = 'flex items-center gap-2 text-xs text-text-secondary';
                const toggle = document.createElement('input');
                toggle.type = 'checkbox';
                toggle.className = 'w-4 h-4 bg-bg-secondary border border-border-subtle rounded cursor-pointer accent-accent-primary';
                toggle.checked = item.enabled !== false;
                toggleWrap.appendChild(toggle);
                toggleWrap.appendChild(document.createTextNode('Active'));

                const selectWrap = document.createElement('div');
                selectWrap.className = 'flex items-center gap-2';
                const select = document.createElement('select');
                select.className = 'h-9 px-3 bg-bg-secondary border border-border-subtle rounded-md text-text-primary text-xs cursor-pointer transition-colors duration-200 hover:border-border-focus focus:outline-none focus:border-accent-primary';

                const placeholder = document.createElement('option');
                placeholder.value = '';
                placeholder.textContent = 'Select tag ID';
                select.appendChild(placeholder);

                TAG_ID_OPTIONS.forEach(tagId => {
                    const option = document.createElement('option');
                    option.value = String(tagId);
                    option.textContent = `ID ${tagId}`;
                    select.appendChild(option);
                });

                if (Number.isInteger(item.tagId)) {
                    select.value = String(item.tagId);
                } else {
                    select.value = '';
                }
                tagSelects.push(select);

                const preview = document.createElement('div');
                preview.className = 'w-[56px] h-[56px] bg-bg-secondary border border-border-subtle rounded-md flex items-center justify-center overflow-hidden';
                const img = document.createElement('img');
                img.className = 'w-full h-full object-contain';
                img.alt = item.label ? `${item.label} tag` : 'Tag preview';
                const placeholderText = document.createElement('span');
                placeholderText.className = 'text-[9px] text-text-muted uppercase tracking-wider';
                placeholderText.textContent = 'No tag';

                preview.appendChild(img);
                preview.appendChild(placeholderText);

                const updatePreview = () => {
                    const tagValue = Number.isInteger(item.tagId) ? item.tagId : null;
                    if (tagValue === null) {
                        img.src = '';
                        img.style.display = 'none';
                        placeholderText.style.display = 'block';
                    } else {
                        img.src = getTagImageSrc(tagValue);
                        img.style.display = 'block';
                        placeholderText.style.display = 'none';
                    }
                    const disabled = !toggle.checked;
                    select.disabled = disabled;
                    preview.classList.toggle('opacity-40', disabled);
                };

                updatePreview();

                toggle.addEventListener('change', () => {
                    item.enabled = toggle.checked;
                    markSaved('Unsaved changes');
                    updatePreview();
                });

                select.addEventListener('change', () => {
                    item.tagId = select.value === '' ? null : Number.parseInt(select.value, 10);
                    markSaved('Unsaved changes');
                    updatePreview();
                    updateTagSelects();
                    renderStickerConfig(); // Update sticker tag selects
                });

                selectWrap.appendChild(select);
                selectWrap.appendChild(preview);

                row.appendChild(labelWrap);
                row.appendChild(toggleWrap);
                row.appendChild(selectWrap);
                list.appendChild(row);
            });
        }

        wrapper.appendChild(header);
        wrapper.appendChild(list);
        els.tagConfig.appendChild(wrapper);
    });
    updateTagSelects();
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
    normalizeTagConfig();
    normalizeDrawingConfig();
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
            loadResponses(state.project.id);
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

function switchProjectSubtab(subtabName) {
    if (!subtabName) return;

    document.querySelectorAll('.project-subtab-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.subtab === subtabName) {
            btn.classList.add('active');
        }
    });

    document.querySelectorAll('.project-subtab-panel').forEach(panel => {
        if (panel.dataset.subpanel === subtabName) {
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

    // Project sub-tabs
    document.querySelectorAll('.project-subtab-btn').forEach(btn => {
        btn.addEventListener('click', () => switchProjectSubtab(btn.dataset.subtab));
    });
    const activeProjectSubtab = document.querySelector('.project-subtab-btn.active');
    if (activeProjectSubtab) {
        switchProjectSubtab(activeProjectSubtab.dataset.subtab);
    }

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

    // Responses upload
    els.uploadResponsesBtn?.addEventListener('click', () => {
        els.uploadResponsesInput?.click();
    });
    els.uploadResponsesInput?.addEventListener('change', async (e) => {
        const file = e.target.files && e.target.files[0] ? e.target.files[0] : null;
        if (!file) return;
        await uploadResponsesFile(file);
        e.target.value = '';
    });
    els.responsesFilterStart?.addEventListener('change', renderResponses);
    els.responsesFilterEnd?.addEventListener('change', renderResponses);
    els.responsesSelectAll?.addEventListener('click', toggleSelectAllResponses);
    els.responsesViewSelected?.addEventListener('click', viewSelectedResponses);
    els.responsesDeleteSelected?.addEventListener('click', deleteSelectedResponses);

    // Project actions
    els.newProject?.addEventListener('click', newProject);
    els.deleteProject?.addEventListener('click', deleteCurrentProject);
    els.saveServer?.addEventListener('click', persistStateToServer);
    els.downloadConfig?.addEventListener('click', downloadConfig);
    els.openProject?.addEventListener('click', () => {
        const selected = els.projectDropdown?.value || state.project.id;
        const params = new URLSearchParams();
        if (selected) {
            params.set('project', selected);
        }
        params.set('tui', state.project?.tuiMode ? '1' : '0');
        const query = params.toString();
        const url = query ? `/app?${query}` : '/app';
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
        scheduleResponsesRefresh();
    });

    els.projectRearProjection?.addEventListener('change', e => {
        state.project.rearProjection = e.target.checked;
        markSaved('Unsaved changes');
    });

    els.projectTuiMode?.addEventListener('change', e => {
        state.project.tuiMode = e.target.checked;
        markSaved('Unsaved changes');
    });

    els.tagSettingsCount?.addEventListener('input', e => {
        const raw = Number.parseInt(e.target.value, 10);
        if (!Number.isFinite(raw)) return;
        const nextCount = clampTagSettingsCount(raw);
        if (nextCount !== raw) {
            e.target.value = nextCount;
        }
        updateTagSettingsCount(nextCount);
        renderTagSettings();
        markSaved('Unsaved changes');
    });

    els.projectWorkshopMode?.addEventListener('change', e => {
        state.project.workshopMode = e.target.checked;
        markSaved('Unsaved changes');
    });

    els.addDrawingSetting?.addEventListener('click', () => {
        normalizeDrawingConfig();
        const items = state.project.drawingConfig.items;
        const nextIndex = items.length + 1;
        items.push({
            id: `drawing-${nextIndex}`,
            label: DEFAULT_DRAWING_ITEM.label,
            color: DEFAULT_DRAWING_ITEM.color,
            tagId: DEFAULT_DRAWING_ITEM.tagId
        });
        renderDrawingConfig();
        renderStickerConfig();
        renderTagConfig();
        markSaved('Unsaved changes');
    });

    els.stickerCount?.addEventListener('input', e => {
        const raw = Number.parseInt(e.target.value, 10);
        if (!Number.isFinite(raw)) return;
        const nextCount = clampStickerCount(raw);
        if (nextCount !== raw) {
            e.target.value = nextCount;
        }
        updateStickerCount(nextCount);
        renderStickerConfig();
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
    await loadResponses(state.project.id);
    await loadProjectsList();
    initEvents();
    markSaved(serverConfig ? 'Loaded from server' : 'Loaded defaults');
}

init();
