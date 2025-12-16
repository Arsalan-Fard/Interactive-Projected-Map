import { CONFIG } from './config.js';

let pointA = null;
let pointB = null;

async function getRoute(map) {
    if (!pointA || !pointB) {
        if (map.getSource('route')) {
            map.getSource('route').setData({
                type: 'Feature',
                properties: {},
                geometry: {
                    type: 'LineString',
                    coordinates: []
                }
            });
        }
        return;
    }

    try {
        const query = await fetch('/api/route', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                start: [pointA.lng, pointA.lat],
                end: [pointB.lng, pointB.lat]
            })
        });

        if (!query.ok) {
            console.error("Route request failed");
            return;
        }
        
        const geojson = await query.json();
        
        if (map.getSource('route')) {
            map.getSource('route').setData(geojson);
        } else {
            map.addSource('route', {
                type: 'geojson',
                data: geojson
            });
            
            map.addLayer({
                id: 'route',
                type: 'line',
                source: 'route',
                layout: {
                    'line-join': 'round',
                    'line-cap': 'round'
                },
                paint: {
                    'line-color': '#3887be',
                    'line-width': 5,
                    'line-opacity': 0.75
                }
            });
        }
    } catch (error) {
        console.error("Error fetching route:", error);
    }
}

// Helper function to make a sticker draggable after it's been placed
function makeStickerDraggable(sticker) {
    sticker.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();

        let isDragging = true;

        const moveHandler = (ev) => {
            if (!isDragging) return;
            sticker.style.left = ev.pageX + 'px';
            sticker.style.top = ev.pageY + 'px';
        };

        const upHandler = () => {
            isDragging = false;
            document.removeEventListener('mousemove', moveHandler);
            document.removeEventListener('mouseup', upHandler);
        };

        document.addEventListener('mousemove', moveHandler);
        document.addEventListener('mouseup', upHandler);
    });

    // Add right-click to remove individual sticker
    sticker.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        sticker.remove();
        console.log(`Removed sticker with color: ${sticker.dataset.color}`);
    });
}

export function initDraggableStickers(map) {
    const stickerButtons = document.querySelectorAll('.point-btn');

    stickerButtons.forEach(btn => {
        btn.addEventListener('mousedown', (e) => {
            e.preventDefault();

            // Create a clone of the sticker
            const sticker = document.createElement('div');
            const color = btn.dataset.color;

            Object.assign(sticker.style, {
                position: 'absolute',
                left: e.pageX + 'px',
                top: e.pageY + 'px',
                width: '20px',
                height: '20px',
                backgroundColor: color,
                borderRadius: '50%',
                border: '2px solid white',
                cursor: 'move',
                zIndex: '1000',
                transform: 'translate(-50%, -50%)',
                boxShadow: '0 4px 8px rgba(0, 0, 0, 0.5)',
                userSelect: 'none'
            });

            sticker.dataset.color = color;
            sticker.dataset.typeId = btn.id;
            sticker.classList.add('draggable-sticker');
            document.body.appendChild(sticker);

            let isDragging = true;

            const moveHandler = (ev) => {
                if (!isDragging) return;
                sticker.style.left = ev.pageX + 'px';
                sticker.style.top = ev.pageY + 'px';
            };

            const upHandler = () => {
                isDragging = false;
                document.removeEventListener('mousemove', moveHandler);
                document.removeEventListener('mouseup', upHandler);

                // Add to map at dropped position
                const rect = sticker.getBoundingClientRect();
                const center = [rect.left + rect.width / 2, rect.top + rect.height / 2];
                const coords = map.unproject(center);

                console.log(`Sticker placed at: [${coords.lng}, ${coords.lat}] with color: ${color}`);

                // Make the placed sticker draggable
                makeStickerDraggable(sticker);
            };

            document.addEventListener('mousemove', moveHandler);
            document.addEventListener('mouseup', upHandler);
        });

        // Add double-click to remove stickers from map
        btn.addEventListener('dblclick', (e) => {
            e.preventDefault();
            // Remove all stickers of this color from the map
            const allStickers = document.querySelectorAll('.draggable-sticker');
            allStickers.forEach(sticker => {
                if (sticker.dataset.color === btn.dataset.color) {
                    sticker.remove();
                }
            });
            console.log(`Removed all stickers with color: ${btn.dataset.color}`);
        });
    });
}

export function initDraggableItems(map) {
    const sources = document.querySelectorAll('.draggable-source');
    const placeholders = new WeakMap();
    
    const layerMap = {
        'Bus': 'bus-lanes-layer',
        'Bicycle': 'mobility-infrastructure-layer',
        'Walk': 'walking-network-layer',
        'Roads': 'palaiseau-roads-layer'
    };

    const setLayerVisibility = (btnText, visible) => {
        const layerId = layerMap[btnText];
        if (layerId && map.getLayer(layerId)) {
            map.setLayoutProperty(layerId, 'visibility', visible ? 'visible' : 'none');
        }
    };

    sources.forEach(btn => {
        btn.addEventListener('mousedown', (e) => {
            const isFloating = btn.parentElement === document.body;
            
            if (!isFloating) {
                e.preventDefault(); 
                
                const placeholder = document.createElement('div');
                placeholder.style.flex = '1';
                placeholder.style.height = '100%'; 
                placeholder.style.visibility = 'hidden'; 
                
                placeholders.set(btn, placeholder);
                btn.parentNode.insertBefore(placeholder, btn);
                
                document.body.appendChild(btn);
                
                Object.assign(btn.style, {
                    position: 'absolute',
                    left: e.pageX + 'px',
                    top: e.pageY + 'px',
                    width: 'auto', 
                    height: 'auto',
                    padding: '8px 12px',
                    background: 'rgba(0, 0, 0, 0.8)',
                    color: 'white',
                    border: '1px solid white',
                    cursor: 'move',
                    zIndex: '1000',
                    fontFamily: 'sans-serif',
                    fontSize: '14px',
                    transform: 'translate(-50%, -50%)', 
                    userSelect: 'none'
                });

                // Activate layer when detached
                setLayerVisibility(btn.textContent, true);
            } else {
                e.preventDefault();
            }
            
            let isDragging = true;
            
            const moveHandler = (ev) => {
                if (!isDragging) return;
                btn.style.left = ev.pageX + 'px';
                btn.style.top = ev.pageY + 'px';
            };
            
            const upHandler = () => {
                isDragging = false;
                document.removeEventListener('mousemove', moveHandler);
                document.removeEventListener('mouseup', upHandler);
                
                // Check for A/B Points
                if (btn.textContent === 'A' || btn.textContent === 'B') {
                    const rect = btn.getBoundingClientRect();
                    // We use the center of the button as the point
                    const center = [rect.left + rect.width / 2, rect.top + rect.height / 2];
                    // Unproject to map coordinates
                    const coords = map.unproject(center);
                    
                    if (btn.textContent === 'A') {
                        pointA = coords;
                    } else {
                        pointB = coords;
                    }
                    getRoute(map);
                }
            };
            
            document.addEventListener('mousemove', moveHandler);
            document.addEventListener('mouseup', upHandler);
        });

        btn.addEventListener('dblclick', (e) => {
            const isFloating = btn.parentElement === document.body;
            
            if (isFloating) {
                e.preventDefault();
                e.stopPropagation();
                
                const placeholder = placeholders.get(btn);
                if (placeholder && placeholder.parentNode) {
                    btn.style.cssText = '';
                    placeholder.parentNode.replaceChild(btn, placeholder);
                    placeholders.delete(btn);

                    // Deactivate layer when reset
                    setLayerVisibility(btn.textContent, false);
                    
                    // Reset A/B Points
                    if (btn.textContent === 'A') {
                        pointA = null;
                        getRoute(map);
                    } else if (btn.textContent === 'B') {
                        pointB = null;
                        getRoute(map);
                    }
                }
            }
        });
    });
}
