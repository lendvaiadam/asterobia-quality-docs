/**
 * PhysicsDebugOverlay — On-screen HUD showing physics state of units.
 *
 * Shows per-unit physicsMode (KINEMATIC/DYNAMIC), mode, altitude.
 * Provides dev buttons: Trigger Explosion, Place Mine.
 * Only visible in dev mode (?dev=1).
 */

import { makeDraggable } from './makeDraggable.js';

export class PhysicsDebugOverlay {
    /** @param {Object} game */
    constructor(game) {
        this.game = game;
        this._el = null;
        this._statsEl = null;
        this._interval = null;
        this._build();
    }

    /** @private */
    _build() {
        const el = document.createElement('div');
        el.id = 'physics-debug-overlay';
        el.style.cssText = `
            position: fixed;
            top: 60px; right: 10px;
            background: rgba(0,0,0,0.92);
            color: #0f0;
            font-family: 'Consolas','Monaco',monospace;
            font-size: 11px;
            padding: 0;
            border: 1px solid #f80;
            border-radius: 6px;
            z-index: 16001;
            min-width: 240px;
            max-height: 400px;
            overflow-y: auto;
            box-shadow: 0 4px 20px rgba(255,136,0,0.25);
            user-select: none;
        `;

        // Title bar
        const titleBar = document.createElement('div');
        titleBar.style.cssText = `
            background: #f80; color: #000; padding: 4px 8px;
            font-weight: bold; font-size: 12px; cursor: move;
            border-radius: 5px 5px 0 0;
        `;
        titleBar.textContent = 'PHYSICS DEBUG';
        el.appendChild(titleBar);

        // Content
        const content = document.createElement('div');
        content.style.cssText = 'padding: 6px 8px;';

        // Buttons row
        const btnRow = document.createElement('div');
        btnRow.style.cssText = 'display: flex; gap: 4px; margin-bottom: 6px;';

        const btnExplode = this._makeButton('EXPLODE', '#f44', () => this._triggerExplosion());
        const btnMine = this._makeButton('MINE', '#ff0', () => this._placeMine());
        const btnRock = this._makeButton('ROCK', '#88f', () => this._spawnRock());
        btnRow.appendChild(btnExplode);
        btnRow.appendChild(btnMine);
        btnRow.appendChild(btnRock);
        content.appendChild(btnRow);

        // Stats area
        this._statsEl = document.createElement('div');
        this._statsEl.style.cssText = 'line-height: 1.5;';
        this._statsEl.textContent = 'Waiting for snapshot...';
        content.appendChild(this._statsEl);

        el.appendChild(content);
        document.body.appendChild(el);
        this._el = el;

        makeDraggable(el, titleBar);

        // Update every 200ms
        this._interval = setInterval(() => this._update(), 200);
    }

    /** @private */
    _makeButton(label, color, onClick) {
        const btn = document.createElement('button');
        btn.textContent = label;
        btn.style.cssText = `
            background: ${color}; color: #000; border: none;
            padding: 3px 10px; border-radius: 3px; cursor: pointer;
            font-family: inherit; font-size: 11px; font-weight: bold;
        `;
        btn.addEventListener('click', onClick);
        return btn;
    }

    /** @private */
    _update() {
        const game = this.game;
        if (!game._snapshotBuffer) {
            this._statsEl.textContent = 'No snapshot buffer';
            return;
        }

        const pair = game._snapshotBuffer.getInterpolationPair();
        if (!pair.next) {
            this._statsEl.textContent = 'No snapshots yet';
            return;
        }

        const units = pair.next.units;
        let html = `<div style="color:#888">tick ${pair.next.tick} | buf ${game._snapshotBuffer.size} | α ${pair.alpha.toFixed(2)}</div>`;

        for (const u of units) {
            const isDynamic = u.physicsMode === 'DYNAMIC';
            const color = isDynamic ? '#f44' : '#0f0';
            const modeLabel = u.physicsMode || 'N/A';
            const stateLabel = u.mode || u.state || '?';
            html += `<div style="color:${color}">` +
                `U${u.id} [${modeLabel}] ${stateLabel} ` +
                `alt:${(u.altitude || 0).toFixed(1)} ` +
                `spd:${(u.speed || 0).toFixed(1)}` +
                `</div>`;
        }

        // Show mine count if available
        html += `<div style="color:#888; margin-top:4px">teleports: ${pair.teleports.size}</div>`;

        this._statsEl.innerHTML = html;
    }

    /** @private */
    _triggerExplosion() {
        const game = this.game;
        const unit = game.selectedUnit;
        if (!unit) {
            this._showStatus('Select a unit first! (double-click)', true);
            return;
        }
        this._sendDevCommand('TRIGGER_EXPLOSION', { unitId: unit.id, radius: 8, strength: 6 });
        this._showStatus(`EXPLODE sent → U${unit.id}`);
    }

    /** @private */
    _placeMine() {
        const game = this.game;
        const unit = game.selectedUnit;
        if (!unit) {
            this._showStatus('Select a unit first! (double-click)', true);
            return;
        }
        this._sendDevCommand('PLACE_MINE', { unitId: unit.id });
        this._showStatus(`MINE placed at U${unit.id}`);
    }

    /** @private */
    _spawnRock() {
        const game = this.game;
        const unit = game.selectedUnit;
        if (!unit) {
            this._showStatus('Select a unit first! (double-click)', true);
            return;
        }
        this._sendDevCommand('SPAWN_ROCK', { unitId: unit.id });
        this._showStatus(`ROCK spawned near U${unit.id}`);
    }

    /** @private */
    _showStatus(msg, isError = false) {
        if (!this._statsEl) return;
        const color = isError ? '#f44' : '#0ff';
        const statusDiv = `<div style="color:${color};font-weight:bold;margin-bottom:4px">${msg}</div>`;
        this._statsEl.innerHTML = statusDiv + this._statsEl.innerHTML;
    }

    /** @private */
    async _sendDevCommand(action, payload) {
        const sm = this.game.sessionManager;
        if (!sm || !sm.transport || !sm._sessionChannel) {
            this._showStatus('No active session!', true);
            return;
        }
        try {
            await sm.transport.broadcastToChannel(sm._sessionChannel, { type: 'CMD_ADMIN', action, ...payload });
        } catch (err) {
            this._showStatus(`Send failed: ${err.message}`, true);
        }
    }

    destroy() {
        if (this._interval) clearInterval(this._interval);
        if (this._el) this._el.remove();
    }
}
