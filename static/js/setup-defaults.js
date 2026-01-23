import { DEFAULT_STICKER_COLORS, getDefaultStickerConfig } from './sticker-defaults.js';

export const DEFAULT_STICKER_CONFIG = getDefaultStickerConfig();
export const MAX_STICKER_COUNT = DEFAULT_STICKER_CONFIG.count;
export const DEFAULT_TAG_SETTINGS_COUNT = 10;
export const MAX_TAG_SETTINGS_COUNT = 50;
export const DEFAULT_DRAWING_ITEM = {
    id: 'drawing-1',
    label: 'drawing line',
    color: '#ff00ff',
    tagId: 6
};
export const DEFAULT_DRAWING_CONFIG = {
    items: [{ ...DEFAULT_DRAWING_ITEM }]
};
export const TAG_ID_OPTIONS = Array.from({ length: 43 }, (_, i) => i + 7);
export const TAG_SETTINGS_ID_OPTIONS = Array.from({ length: 50 }, (_, i) => i);
export const TAG_IMAGE_PREFIX = '/generated_tags/tag36h11_id';
export const DRAWING_TAG_ID_OPTIONS = Array.from(new Set([DEFAULT_DRAWING_ITEM.tagId, ...TAG_ID_OPTIONS])).sort((a, b) => a - b);
export const DEFAULT_TAG_GROUPS = {
    reach15: [
        { id: 'walk', label: 'Walk', enabled: true, tagId: null },
        { id: 'bike', label: 'Cycling', enabled: true, tagId: null },
        { id: 'car', label: 'Car', enabled: false, tagId: null }
    ],
    isovist: [
        { id: 'isovist', label: 'Isovist', enabled: true, tagId: null }
    ],
    shortestPath: [
        { id: 'A', label: 'Point A', enabled: true, tagId: null },
        { id: 'B', label: 'Point B', enabled: true, tagId: null }
    ],
    tools: [
        { id: 'eraser', label: 'Eraser', enabled: true, tagId: null }
    ]
};

export const defaultState = {
    project: {
        name: 'Pilot 01',
        location: 'Palaiseau Campus',
        id: 'project-palaiseau',
        mapId: 'palaiseau-outdoor',
        rearProjection: false,
        tuiMode: false,
        workshopMode: false,
        stickerDetectionMode: 'tag',
        tagSettings: {
            count: DEFAULT_TAG_SETTINGS_COUNT,
            items: []
        },
        tagConfig: null,
        drawingConfig: {
            items: DEFAULT_DRAWING_CONFIG.items.map(item => ({ ...item }))
        },
        stickerConfig: {
            count: DEFAULT_STICKER_CONFIG.count,
            colors: [...DEFAULT_STICKER_CONFIG.colors]
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
