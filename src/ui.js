export function initDraggableItems() {
    const sources = document.querySelectorAll('.draggable-source');
    
    sources.forEach(btn => {
        btn.addEventListener('mousedown', (e) => {
            e.preventDefault(); 
            
            // Create the clone
            const clone = document.createElement('div');
            clone.textContent = btn.textContent;
            Object.assign(clone.style, {
                position: 'absolute',
                left: e.pageX + 'px',
                top: e.pageY + 'px',
                padding: '8px 12px',
                background: 'rgba(0, 0, 0, 0.8)',
                color: 'white',
                border: '1px solid white',
                cursor: 'move',
                zIndex: '1000',
                fontFamily: 'sans-serif',
                fontSize: '14px',
                pointerEvents: 'none', // Pass events through during initial drag
                userSelect: 'none',
                transform: 'translate(-50%, -50%)' // Center on cursor
            });
            
            document.body.appendChild(clone);
            
            let isDragging = true;
            
            const moveHandler = (ev) => {
                if (!isDragging) return;
                clone.style.left = ev.pageX + 'px';
                clone.style.top = ev.pageY + 'px';
            };
            
            const upHandler = (ev) => {
                isDragging = false;
                clone.style.pointerEvents = 'auto'; // Enable interaction after drop
                
                document.removeEventListener('mousemove', moveHandler);
                document.removeEventListener('mouseup', upHandler);
                
                // Allow moving the cloned item again
                makeElementDraggable(clone);
            };
            
            document.addEventListener('mousemove', moveHandler);
            document.addEventListener('mouseup', upHandler);
        });
    });
}

function makeElementDraggable(el) {
    el.addEventListener('mousedown', (e) => {
        e.preventDefault();
        let isDragging = true;
        
        // Calculate offset to keep relative position under cursor
        // Note: using transform translate(-50%, -50%) complicates offset calc if we use offsetLeft/Top directly
        // simpler to just track mouse delta or set position directly. 
        // Since we center the element, let's just track cursor position.
        
        const move = (ev) => {
             if (!isDragging) return;
             el.style.left = ev.pageX + 'px';
             el.style.top = ev.pageY + 'px';
        };
        
        const up = () => {
            isDragging = false;
            document.removeEventListener('mousemove', move);
            document.removeEventListener('mouseup', up);
        };
        
        document.addEventListener('mousemove', move);
        document.addEventListener('mouseup', up);
    });

    el.addEventListener('dblclick', () => {
        el.remove();
    });
}