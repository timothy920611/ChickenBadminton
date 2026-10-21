/** Pointer-based player swapping shared by mouse and touch devices. */
export function attachPlayerDrag(grid, onSwap) {
    let active = null;
    let ghost = null;
    let highlight = null;

    function targetAt(event) {
        const target = document.elementFromPoint(event.clientX, event.clientY)
            ?.closest('.drag-player, .bench-drop-target');
        return target && grid.contains(target) ? target : null;
    }

    function move(event) {
        if (!active || event.pointerId !== active.pointerId) return;
        event.preventDefault();
        ghost.style.left = `${event.clientX - ghost.offsetWidth / 2}px`;
        ghost.style.top = `${event.clientY - ghost.offsetHeight / 2}px`;
        const target = targetAt(event);
        if (highlight !== target) {
            highlight?.classList.remove('drag-over-card');
            highlight = target;
            highlight?.classList.add('drag-over-card');
        }
    }

    function cleanup() {
        ghost?.remove();
        ghost = null;
        highlight?.classList.remove('drag-over-card');
        highlight = null;
        active?.element.classList.remove('dragging');
        active = null;
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', finish);
        document.removeEventListener('pointercancel', cancel);
        window.removeEventListener('blur', cancel);
    }

    function finish(event) {
        if (!active || event.pointerId !== active.pointerId) return;
        const source = active.element.dataset;
        const destination = targetAt(event)?.dataset;
        cleanup();
        if (destination) onSwap(source.teamId, source.slot, destination.teamId, destination.slot);
    }

    function cancel() { cleanup(); }

    function start(event) {
        if (active || (event.pointerType === 'mouse' && event.button !== 0)) return;
        const element = event.target.closest('.drag-handle')?.closest('.drag-player');
        if (!element || !grid.contains(element)) return;
        event.preventDefault();
        active = { element, pointerId: event.pointerId };
        ghost = element.cloneNode(true);
        ghost.classList.add('player-drag-ghost');
        ghost.style.width = `${element.offsetWidth}px`;
        ghost.removeAttribute('id');
        document.body.appendChild(ghost);
        element.classList.add('dragging');
        document.addEventListener('pointermove', move, { passive: false });
        document.addEventListener('pointerup', finish);
        document.addEventListener('pointercancel', cancel);
        window.addEventListener('blur', cancel);
        move(event);
    }

    grid.addEventListener('pointerdown', start);
    return () => { cleanup(); grid.removeEventListener('pointerdown', start); };
}
