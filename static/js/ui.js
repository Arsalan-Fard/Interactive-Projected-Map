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

function createStickerMarker(map, lngLat, color, typeId, questionId) {
    const sticker = document.createElement('div');
    Object.assign(sticker.style, {
        width: '20px',
        height: '20px',
        backgroundColor: color,
        borderRadius: '50%',
        border: '2px solid white',
        cursor: 'move',
        boxShadow: '0 4px 8px rgba(0, 0, 0, 0.5)',
        userSelect: 'none'
    });

    sticker.dataset.color = color;
    sticker.dataset.typeId = typeId;
    if (questionId) {
        sticker.dataset.questionId = questionId;
    }
    sticker.classList.add('draggable-sticker');

    const marker = new mapboxgl.Marker({ element: sticker, draggable: true })
        .setLngLat(lngLat)
        .addTo(map);

    sticker._marker = marker;

    const syncPosition = () => {
        const pos = marker.getLngLat();
        sticker.dataset.lng = pos.lng;
        sticker.dataset.lat = pos.lat;
    };

    syncPosition();
    marker.on('dragend', syncPosition);

    sticker.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        marker.remove();
        console.log(`Removed sticker with color: ${sticker.dataset.color}`);
    });
}

export function initDraggableStickers(map, getQuestionId) {
    const stickerButtons = document.querySelectorAll('.point-btn');

    stickerButtons.forEach(btn => {
        btn.addEventListener('mousedown', (e) => {
            e.preventDefault();

            // Create a drag ghost
            const ghost = document.createElement('div');
            const color = btn.dataset.color;

            Object.assign(ghost.style, {
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

            document.body.appendChild(ghost);

            let isDragging = true;

            const moveHandler = (ev) => {
                if (!isDragging) return;
                ghost.style.left = ev.pageX + 'px';
                ghost.style.top = ev.pageY + 'px';
            };

            const upHandler = (ev) => {
                isDragging = false;
                document.removeEventListener('mousemove', moveHandler);
                document.removeEventListener('mouseup', upHandler);

                ghost.remove();

                const mapRect = map.getContainer().getBoundingClientRect();
                const point = {
                    x: ev.clientX - mapRect.left,
                    y: ev.clientY - mapRect.top
                };

                if (point.x < 0 || point.y < 0 || point.x > mapRect.width || point.y > mapRect.height) {
                    return;
                }

                const coords = map.unproject([point.x, point.y]);
                console.log(`Sticker placed at: [${coords.lng}, ${coords.lat}] with color: ${color}`);
                const questionId = typeof getQuestionId === 'function' ? getQuestionId() : null;
                createStickerMarker(map, coords, color, btn.id, questionId);
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
                    if (sticker._marker && typeof sticker._marker.remove === 'function') {
                        sticker._marker.remove();
                    } else {
                        sticker.remove();
                    }
                }
            });
            console.log(`Removed all stickers with color: ${btn.dataset.color}`);
        });
    });
}

export function initLayerToggles(map) {
    const layerMap = {
        'btn-layer-bus': 'bus-lanes-layer',
        'btn-layer-bike': 'mobility-infrastructure-layer',
        'btn-layer-walk': 'walking-network-layer',
        'btn-layer-roads': 'palaiseau-roads-layer'
    };

    Object.keys(layerMap).forEach(btnId => {
        const btn = document.getElementById(btnId);
        if (btn) {
            btn.addEventListener('click', () => {
                const layerId = layerMap[btnId];
                const isActive = btn.classList.toggle('active');
                
                if (map.getLayer(layerId)) {
                    map.setLayoutProperty(layerId, 'visibility', isActive ? 'visible' : 'none');
                }
            });
        }
    });
}

export function initDraggableItems(map) {
    const sources = document.querySelectorAll('.draggable-source');
    const placeholders = new WeakMap();

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
                    userSelect: 'none',
                    transition: 'none'
                });
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
