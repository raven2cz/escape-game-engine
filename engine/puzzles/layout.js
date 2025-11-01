/**
 * Compute absolute CSS positioning (in %) for a rect inside the scene.
 * @param {{x:number,y:number,w:number,h:number}} rect
 * @returns {Record<string,string>} style map
 */
export function rectToStyle(rect) {
    return {
        left: rect.x + '%',
        top: rect.y + '%',
        width: rect.w + '%',
        height: rect.h + '%'
    };
}

/**
 * Apply auto layout onto container element (.pz__flow) for vertical/horizontal/grid.
 *
 * @param {HTMLElement} root
 * @param {{mode:"auto"|"manual", direction?:"vertical"|"horizontal"|"grid", grid?:{cols?:number}}} layout
 */
export function applyAutoLayout(root, layout) {
    const mode = layout?.mode || 'auto';
    root.classList.toggle('pz--auto', mode === 'auto');
    root.classList.toggle('pz--manual', mode === 'manual');

    root.classList.remove('pz--vertical', 'pz--horizontal', 'pz--grid');
    if (mode === 'auto') {
        const dir = layout?.direction || 'vertical';
        if (dir === 'grid') {
            root.classList.add('pz--grid');
            const cols = layout?.grid?.cols ?? 3;
            const flow = root.querySelector('.pz__flow');
            if (flow) flow.setAttribute('data-cols', String(cols));
        } else if (dir === 'horizontal') {
            root.classList.add('pz--horizontal');
        } else {
            root.classList.add('pz--vertical');
        }
    }

    // Debug (toggle with ?debug=1)
    try {
        if (typeof window !== 'undefined' && /\bdebug=1\b/.test(window.location.search)) {
            console.debug('[PZ] layout classes:', root.className);
        }
    } catch {
    }
}
