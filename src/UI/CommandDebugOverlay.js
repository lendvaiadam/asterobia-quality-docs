/**
 * CommandDebugOverlay - Debug visualization for InputFactory commands
 *
 * R006: Shows commands produced by InputFactory in real-time.
 * Toggle: Shift+C
 *
 * Displays:
 * - Pending commands (waiting to be processed)
 * - Recent history (last N processed commands)
 */

import { globalCommandQueue } from '../SimCore/runtime/CommandQueue.js';

export class CommandDebugOverlay {
    constructor() {
        this._visible = false;
        this._element = null;
        this._updateInterval = null;

        this._createOverlay();
        this._bindToggle();
    }

    _createOverlay() {
        const el = document.createElement('div');
        el.id = 'command-debug-overlay';
        el.style.cssText = `
            position: fixed;
            top: 10px;
            right: 10px;
            width: 320px;
            max-height: 400px;
            background: rgba(0, 0, 0, 0.85);
            color: #0f0;
            font-family: monospace;
            font-size: 11px;
            padding: 10px;
            border: 1px solid #0f0;
            border-radius: 4px;
            z-index: 10000;
            overflow-y: auto;
            display: none;
        `;
        document.body.appendChild(el);
        this._element = el;

        // R006-fix: Add visible toggle button (fallback for keyboard focus issues)
        this._createToggleButton();
    }

    _createToggleButton() {
        const btn = document.createElement('button');
        btn.id = 'command-debug-toggle';
        btn.textContent = 'CMD';
        btn.title = 'Toggle Command Debug Overlay (Shift+C)';
        btn.style.cssText = `
            position: fixed;
            top: 10px;
            right: 340px;
            width: 40px;
            height: 24px;
            background: rgba(0, 0, 0, 0.7);
            color: #0f0;
            border: 1px solid #0f0;
            border-radius: 3px;
            font-family: monospace;
            font-size: 10px;
            cursor: pointer;
            z-index: 10001;
        `;
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggle();
        });
        document.body.appendChild(btn);
        this._toggleButton = btn;
    }

    _bindToggle() {
        // R006-fix: Use capture phase to intercept before any element blocks it
        window.addEventListener('keydown', (e) => {
            // Shift+C to toggle
            if (e.shiftKey && e.code === 'KeyC') {
                this.toggle();
                e.preventDefault();
            }
        }, { capture: true });
    }

    toggle() {
        this._visible = !this._visible;

        if (this._visible) {
            this._element.style.display = 'block';
            this._startUpdates();
        } else {
            this._element.style.display = 'none';
            this._stopUpdates();
        }
    }

    show() {
        this._visible = true;
        this._element.style.display = 'block';
        this._startUpdates();
    }

    hide() {
        this._visible = false;
        this._element.style.display = 'none';
        this._stopUpdates();
    }

    _startUpdates() {
        if (this._updateInterval) return;
        this._updateInterval = setInterval(() => this._render(), 100);
        this._render(); // Immediate first render
    }

    _stopUpdates() {
        if (this._updateInterval) {
            clearInterval(this._updateInterval);
            this._updateInterval = null;
        }
    }

    _render() {
        const queue = globalCommandQueue;
        const pending = queue.getPending();
        const history = queue.getRecentHistory(8);

        let html = `
            <div style="border-bottom: 1px solid #0f0; margin-bottom: 8px; padding-bottom: 4px;">
                <strong>📋 InputFactory Commands</strong>
                <span style="float: right; color: #888;">[Shift+C]</span>
            </div>
        `;

        // Pending section
        html += `<div style="color: #ff0; margin-bottom: 8px;">
            <strong>⏳ Pending (${pending.length})</strong>
        </div>`;

        if (pending.length === 0) {
            html += `<div style="color: #666; margin-left: 10px;">none</div>`;
        } else {
            for (const cmd of pending) {
                html += this._formatCommand(cmd, 'pending');
            }
        }

        // History section
        html += `<div style="color: #0ff; margin: 8px 0;">
            <strong>✓ History (${queue.historyCount})</strong>
        </div>`;

        if (history.length === 0) {
            html += `<div style="color: #666; margin-left: 10px;">none</div>`;
        } else {
            for (const cmd of history) {
                html += this._formatCommand(cmd, 'history');
            }
        }

        this._element.innerHTML = html;
    }

    _formatCommand(cmd, status) {
        const color = status === 'pending' ? '#ff0' : '#0f0';
        const tickInfo = cmd.processedAtTick !== undefined
            ? `T${cmd.processedAtTick}`
            : (cmd.scheduledTick !== null ? `@T${cmd.scheduledTick}` : 'imm');

        let details = '';
        switch (cmd.type) {
            case 'SELECT':
                details = `unit=${cmd.unitId}`;
                break;
            case 'DESELECT':
                details = '';
                break;
            case 'MOVE':
                details = `unit=${cmd.unitId} pos=(${cmd.position.x.toFixed(1)},${cmd.position.y.toFixed(1)},${cmd.position.z.toFixed(1)})`;
                break;
            case 'SET_PATH':
                details = `unit=${cmd.unitId} pts=${cmd.points.length}`;
                break;
            case 'CLOSE_PATH':
                details = `unit=${cmd.unitId}`;
                break;
            default:
                details = JSON.stringify(cmd).slice(0, 40);
        }

        return `
            <div style="margin-left: 10px; margin-bottom: 4px; color: ${color};">
                <span style="color: #888;">#${cmd.seq}</span>
                <span style="color: #fff;">${cmd.type}</span>
                <span style="color: #888;">${tickInfo}</span>
                ${details ? `<br><span style="margin-left: 20px; color: #aaa;">${details}</span>` : ''}
            </div>
        `;
    }

    /**
     * Check if overlay is visible.
     */
    get isVisible() {
        return this._visible;
    }
}

/**
 * Global overlay singleton.
 */
export const globalCommandDebugOverlay = new CommandDebugOverlay();
