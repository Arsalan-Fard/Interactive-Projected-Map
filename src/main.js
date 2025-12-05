import { CONFIG } from './config.js';
import { add3DBuildings, addPalaiseauRoads, addWalkingNetwork, addMobilityInfrastructure, addAmenities, addBusLanes } from './layers.js';
import { initDraggableItems } from './ui.js';

mapboxgl.accessToken = CONFIG.accessToken;

const map = new mapboxgl.Map({
    container: 'map',
    style: CONFIG.style,
    center: CONFIG.center,
    zoom: CONFIG.zoom,
    pitch: CONFIG.pitch,
    bearing: CONFIG.bearing,
    attributionControl: false
});

map.on('style.load', () => {
    console.log("Style loaded!");
    
    add3DBuildings(map);
    addPalaiseauRoads(map);
    addWalkingNetwork(map);
    addMobilityInfrastructure(map);
    addBusLanes(map);
    addAmenities(map);
});

const styles = {
    'btn-light': 'mapbox://styles/mapbox/light-v11',
    'btn-dark': 'mapbox://styles/mapbox/dark-v11',
    'btn-streets': 'mapbox://styles/mapbox/streets-v12',
    'btn-satellite': 'mapbox://styles/mapbox/satellite-streets-v12'
};

Object.keys(styles).forEach(id => {
    const btn = document.getElementById(id);
    if (btn) {
        btn.addEventListener('click', () => {
            Object.keys(styles).forEach(key => {
                document.getElementById(key).classList.remove('active');
            });
            
            btn.classList.add('active');
            
            map.setStyle(styles[id]);
        });
    }
});

const mapContainer = document.getElementById('map');
const layout = {
    get x() { return mapContainer.clientWidth; },
    get y() { return mapContainer.clientHeight; }
};

const debugDot = document.createElement('div');
Object.assign(debugDot.style, {
    position: 'absolute',
    width: '20px',
    height: '20px',
    backgroundColor: 'red',
    borderRadius: '50%',
    zIndex: '9999',
    pointerEvents: 'none',
    transform: 'translate(-50%, -50%)', 
    display: 'none', 
    left: '0px',
    top: '0px'
});
mapContainer.appendChild(debugDot);

async function checkPosition() {
    try {
        const response = await fetch('http://localhost:5000/api/position');
        if (!response.ok) return; 

        const data = await response.json();

        if (data.valid) {
            const clampedX = Math.max(0, Math.min(1, data.x));
            const clampedY = Math.max(0, Math.min(1, data.y));

            
            const absX = clampedX * layout.x;
            const absY = clampedY * layout.y;

            console.log(`x=${absX.toFixed(2)} y=${absY.toFixed(2)} relX=${clampedX.toFixed(2)} relY=${clampedY.toFixed(2)}`);

            debugDot.style.left = `${absX}px`;
            debugDot.style.top = `${absY}px`;
            debugDot.style.display = 'block';
        } else {
            debugDot.style.display = 'none';
        }
    } catch (error) {
    }
}

setInterval(checkPosition, 100);
initDraggableItems();