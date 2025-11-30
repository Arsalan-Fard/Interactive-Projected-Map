export function addDrawControls(map) {
    const draw = new MapboxDraw({
        displayControlsDefault: false,
        controls: {
            polygon: true,
            line_string: true,
            trash: true
        }
    });
    
    map.addControl(draw, 'top-right');
    
    return draw; 
}