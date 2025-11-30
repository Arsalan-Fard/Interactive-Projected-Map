import { CONFIG } from './config.js';
import { add3DBuildings, addPalaiseauRoads } from './layers.js';
import { addDrawControls } from './tools.js';

// 1. Setup
mapboxgl.accessToken = CONFIG.accessToken;

const map = new mapboxgl.Map({
    container: 'map',
    style: CONFIG.style,
    center: CONFIG.center,
    zoom: CONFIG.zoom,
    pitch: CONFIG.pitch,
    bearing: CONFIG.bearing
});

// 2. Load Layers when map is ready
map.on('load', () => {
    console.log("Map loaded!");
    
    add3DBuildings(map);
    addPalaiseauRoads(map);
});

// 3. Add Tools
const drawTool = addDrawControls(map);

