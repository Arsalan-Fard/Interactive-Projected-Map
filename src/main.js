import { CONFIG } from './config.js';
import { add3DBuildings, addPalaiseauRoads, addWalkingNetwork, addMobilityInfrastructure, addAmenities, addBusLanes, addFloorplan } from './layers.js';
import { initDraggableItems, initDraggableStickers } from './ui.js';

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
    console.log("Style loaded event fired!");
    
    add3DBuildings(map);
    addPalaiseauRoads(map);
    addWalkingNetwork(map);
    addMobilityInfrastructure(map);
    addBusLanes(map);
    addAmenities(map);
    addFloorplan(map);
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
            console.log("Button clicked:", id);
            Object.keys(styles).forEach(key => {
                document.getElementById(key).classList.remove('active');
            });
            
            btn.classList.add('active');
            
            console.log("Setting style to:", styles[id]);
            map.setStyle(styles[id]);
            btn.blur(); // Remove focus so Space key doesn't trigger it again
        });
    }
});

const mapContainer = document.getElementById('map');
const layout = {
    get x() { return window.innerWidth; },
    get y() { return window.innerHeight; }
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
    left: '0%',
    top: '0%'
});
// Move dot into the container so it warps with Maptastic
document.getElementById('main_container').appendChild(debugDot);

async function checkPosition() {
    try {
        const response = await fetch('http://localhost:5000/api/position');
        if (!response.ok) return; 

        const data = await response.json();

        if (data.valid) {
            const clampedX = Math.max(0, Math.min(1, data.x));
            const clampedY = Math.max(0, Math.min(1, data.y));

            // Position using percentages so it aligns with the warped container
            debugDot.style.left = `${clampedX * 100}%`;
            debugDot.style.top = `${clampedY * 100}%`;
            debugDot.style.display = 'block';

            if (data.id === 5) {
                // Use the visual screen position of the dot for interaction
                const dotRect = debugDot.getBoundingClientRect();
                const element = document.elementFromPoint(
                    dotRect.left + dotRect.width / 2, 
                    dotRect.top + dotRect.height / 2
                );

                if (element) {
                    const button = element.closest('button');
                    if (button && styles[button.id] && !button.classList.contains('active')) {
                        button.click();
                    }
                }
            }
        } else {
            debugDot.style.display = 'none';
        }
    } catch (error) {
    }
}

setInterval(checkPosition, 100);
initDraggableItems(map);
initDraggableStickers(map);

// Drawing Tool functionality
const draw = new MapboxDraw({
    displayControlsDefault: true,
    controls: {
        point: true,
        line_string: true,
        polygon: true,
        trash: true
    }
});

const drawBtn = document.getElementById('btn-draw');
if (drawBtn) {
    drawBtn.addEventListener('click', () => {
        drawBtn.classList.toggle('active');
        if (drawBtn.classList.contains('active')) {
            console.log('Drawing tool activated');
            map.addControl(draw, 'top-left');
        } else {
            console.log('Drawing tool deactivated');
            map.removeControl(draw);
        }
    });
}

// 15min Isochrone functionality
const isochroneBtn = document.getElementById('btn-isochrone');
if (isochroneBtn) {
    isochroneBtn.addEventListener('click', () => {
        isochroneBtn.classList.toggle('active');
        if (isochroneBtn.classList.contains('active')) {
            console.log('15min Isochrone activated');
            // TODO: Implement isochrone functionality
        } else {
            console.log('15min Isochrone deactivated');
        }
    });
}

// Question panel navigation
const questions = [
    "How do you typically travel to campus?",
    "Where do you suggest to add more bike lanes?",
    "In Which points do you get confused?"
];

let currentQuestionIndex = 0;

const prevBtn = document.getElementById('prev-btn');
const nextBtn = document.getElementById('next-btn');
const questionText = document.querySelector('.question-text');
const dots = document.querySelectorAll('.dot');

function updateQuestion() {
    // Update question text
    questionText.textContent = questions[currentQuestionIndex];

    // Update dots
    dots.forEach((dot, index) => {
        dot.classList.toggle('active', index === currentQuestionIndex);
    });

    // Update button states
    prevBtn.disabled = currentQuestionIndex === 0;
    nextBtn.disabled = currentQuestionIndex === questions.length - 1;
}

prevBtn.addEventListener('click', () => {
    if (currentQuestionIndex > 0) {
        currentQuestionIndex--;
        updateQuestion();
    }
});

nextBtn.addEventListener('click', async () => {
    // Capture stickers for the current question
    const stickers = document.querySelectorAll('.draggable-sticker');
    if (stickers.length > 0) {
        const features = Array.from(stickers).map(sticker => {
            const rect = sticker.getBoundingClientRect();
            const center = [rect.left + rect.width / 2, rect.top + rect.height / 2];
            const coords = map.unproject(center);
            
            return {
                type: 'Feature',
                geometry: {
                    type: 'Point',
                    coordinates: [coords.lng, coords.lat]
                },
                properties: {
                    id: sticker.dataset.typeId, // The button ID (e.g., sticker-btn-1)
                    color: sticker.dataset.color,
                    questionIndex: currentQuestionIndex,
                    timestamp: new Date().toISOString()
                }
            };
        });

        const geojson = {
            type: 'FeatureCollection',
            features: features
        };

        const filename = `stickers_q${currentQuestionIndex}_${new Date().toISOString().replace(/[:.]/g, '-')}.geojson`;
        
        try {
            const response = await fetch('/api/save_geojson', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    geojson: geojson,
                    filename: filename
                })
            });

            if (response.ok) {
                console.log(`Saved sticker GeoJSON for Question ${currentQuestionIndex} to server`);
            } else {
                console.error('Failed to save GeoJSON to server');
            }
        } catch (error) {
            console.error('Error saving GeoJSON to server:', error);
        }
    }

    if (currentQuestionIndex < questions.length - 1) {
        currentQuestionIndex++;
        updateQuestion();
    }
});

// Allow clicking on dots to navigate
dots.forEach((dot, index) => {
    dot.addEventListener('click', () => {
        currentQuestionIndex = index;
        updateQuestion();
    });
});

// Initialize
updateQuestion();