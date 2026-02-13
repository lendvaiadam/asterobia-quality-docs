/**
 * makeDraggable — Adds drag-to-move behavior to any fixed/absolute DOM element.
 *
 * Usage: makeDraggable(panelElement, handleElement?)
 *   - panelElement: the container to move
 *   - handleElement: (optional) the drag handle (e.g. title bar). Defaults to panelElement.
 *
 * Sets cursor style on the handle. Converts any CSS positioning (top/right/bottom/left/transform)
 * to explicit left/top on first drag so the element moves predictably.
 *
 * @param {HTMLElement} panel - The panel element to make draggable
 * @param {HTMLElement} [handle] - The drag handle element (defaults to panel)
 */
export function makeDraggable(panel, handle) {
    const grip = handle || panel;
    grip.style.cursor = 'grab';

    let startX, startY, startLeft, startTop, dragging = false;

    grip.addEventListener('mousedown', (e) => {
        // Don't drag if clicking on inputs, buttons, sliders
        const tag = e.target.tagName.toLowerCase();
        if (tag === 'input' || tag === 'button' || tag === 'select' || tag === 'textarea') return;

        dragging = true;
        grip.style.cursor = 'grabbing';

        // On first drag, normalize position to left/top (from any combo of top/right/bottom/left/transform)
        const rect = panel.getBoundingClientRect();
        panel.style.left = rect.left + 'px';
        panel.style.top = rect.top + 'px';
        panel.style.right = 'auto';
        panel.style.bottom = 'auto';
        panel.style.transform = 'none';

        startX = e.clientX;
        startY = e.clientY;
        startLeft = rect.left;
        startTop = rect.top;

        e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
        if (!dragging) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        panel.style.left = (startLeft + dx) + 'px';
        panel.style.top = (startTop + dy) + 'px';
    });

    document.addEventListener('mouseup', () => {
        if (!dragging) return;
        dragging = false;
        grip.style.cursor = 'grab';
    });
}
