import { CONFIG } from './config.js';
import { getDefaultStickerConfig } from './sticker-defaults.js';

const fallbackOverlays = [
    'palaiseau-roads',
    'walking-network',
    'mobility-infrastructure',
    'bus-lanes',
    'amenities',
    'telecom-floorplan'
];

export const fallbackConfig = {
    project: {
        id: 'default-project',
        name: 'Default',
        location: 'Palaiseau',
        mapId: 'palaiseau-outdoor',
        rearProjection: false,
        workshopMode: false,
        stickerConfig: getDefaultStickerConfig()
    },
    maps: [
        {
            id: 'palaiseau-outdoor',
            label: 'IP Paris Campus',
            style: CONFIG.style,
            center: CONFIG.center,
            zoom: CONFIG.zoom,
            pitch: CONFIG.pitch,
            bearing: CONFIG.bearing,
            overlays: fallbackOverlays
        }
    ],
    overlays: fallbackOverlays.map(id => ({ id })),
    questionFlow: [
        {
            id: 'default',
            title: 'Default',
            order: 1,
            questions: [
                { id: 'travel-mode', text: 'How do you typically travel to campus?', type: 'single-choice', options: ['Walk', 'Bike', 'Bus', 'Car', 'Other'], required: false, storageKey: 'travel_mode', responseShape: 'scalar' },
                { id: 'bike-lanes', text: 'Where do you suggest to add more bike lanes?', type: 'sticker', options: [], required: false, storageKey: 'bike_lanes', responseShape: 'point-collection' },
                { id: 'confused', text: 'In Which points do you get confused?', type: 'sticker', options: [], required: false, storageKey: 'confused_points', responseShape: 'point-collection' }
            ]
        }
    ]
};

function normalizeStickerConfig(existing) {
    const defaults = getDefaultStickerConfig();
    const fallbackColors = defaults.colors;
    const colors = Array.isArray(existing?.colors) ? existing.colors.slice(0, fallbackColors.length) : [];
    let count = Number.isInteger(existing?.count) ? existing.count : null;

    if (!count) {
        count = colors.length > 0 ? colors.length : fallbackColors.length;
    }

    count = Math.max(1, Math.min(fallbackColors.length, count));

    while (colors.length < count) {
        colors.push(fallbackColors[colors.length] || '#cccccc');
    }

    const tags = Array.isArray(existing?.tags) ? existing.tags.slice(0, count) : [];
    while (tags.length < count) {
        tags.push(null);
    }

    return {
        count,
        colors: colors.slice(0, count),
        tags
    };
}

function normalizeConfig(raw) {
    const project = raw?.project || fallbackConfig.project;
    let selectedMap = raw?.map;

    if (!selectedMap && raw?.maps?.length) {
        selectedMap = raw.maps.find(m => m.id === project.mapId) || raw.maps[0];
    }
    if (!selectedMap) selectedMap = fallbackConfig.maps[0];

    const derivedQuestionFlow = () => {
        if (raw?.questionFlow) return raw.questionFlow;
        if (raw?.questions) return raw.questions; // Support flat questions
        if (raw?.questionGroups) {
            return raw.questionGroups.map(group => ({
                id: group.id,
                title: group.title,
                description: group.description,
                order: group.order,
                questions: group.questions || []
            }));
        }
        return null;
    };

    const questionFlow = derivedQuestionFlow() || fallbackConfig.questionFlow;

    return {
        project: {
            ...project,
            stickerConfig: normalizeStickerConfig(project?.stickerConfig)
        },
        maps: raw?.maps || fallbackConfig.maps,
        map: {
            style: selectedMap.style || fallbackConfig.maps[0].style,
            center: selectedMap.center || fallbackConfig.maps[0].center,
            zoom: selectedMap.zoom ?? fallbackConfig.maps[0].zoom,
            pitch: selectedMap.pitch ?? fallbackConfig.maps[0].pitch,
            bearing: selectedMap.bearing ?? fallbackConfig.maps[0].bearing,
            overlays: (selectedMap.overlays !== undefined) ? selectedMap.overlays : fallbackOverlays
        },
        overlays: raw?.overlays || fallbackConfig.overlays,
        questionFlow
    };
}

function getQueryProjectId() {
    const params = new URLSearchParams(window.location.search);
    return params.get('project');
}

function parseQueryFlag(value) {
    if (value === null || value === undefined) return null;
    const normalized = String(value).trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    return null;
}

function getQueryTuiMode() {
    const params = new URLSearchParams(window.location.search);
    return parseQueryFlag(params.get('tui'));
}

async function fetchServerConfig(projectId) {
    try {
        const url = projectId ? `/api/config?project=${encodeURIComponent(projectId)}` : '/api/config';
        const response = await fetch(url);
        if (response.ok) {
            return await response.json();
        }
    } catch (error) {
        console.warn('No server config found', error);
    }
    return null;
}

export async function loadSetupConfig() {
    const projectId = getQueryProjectId();
    const serverConfig = await fetchServerConfig(projectId);
    const baseConfig = serverConfig ? normalizeConfig(serverConfig) : normalizeConfig(fallbackConfig);
    const tuiOverride = getQueryTuiMode();
    if (tuiOverride !== null) {
        baseConfig.project = { ...baseConfig.project, tuiMode: tuiOverride };
    }
    return baseConfig;
}
