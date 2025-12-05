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
                }
            }
        });
    });
}