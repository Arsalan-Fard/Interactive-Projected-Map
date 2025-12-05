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
        const query = await fetch('http://localhost:5001/api/route', {
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
