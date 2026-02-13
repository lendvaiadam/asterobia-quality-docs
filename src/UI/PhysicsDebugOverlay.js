/**
 * PhysicsDebugOverlay — On-screen HUD showing physics state of units.
 *
 * Shows per-unit physicsMode (KINEMATIC/DYNAMIC), mode, altitude.
 * Provides dev buttons: Trigger Explosion, Place Mine, Spawn Rock.
 * Only visible in dev mode (?dev=1).
 *
 * Reads from SERVER_SNAPSHOT buffer when available (mirror/guest mode),
 * otherwise falls back to local game.units (host mode).
 */

import { makeDraggable } from './makeDraggable.js';

export class PhysicsDebugOverlay {
    /** @param {Object} game */
    constructor(game) {
        this.game = game;
        this._el = null;
        this._statsEl = null;
        this._statusEl = null;
        this._interval = null;
        this._statusTimer = null;
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

        // Status area (persistent feedback for button clicks)
        this._statusEl = document.createElement('div');
        this._statusEl.style.cssText = 'min-height: 16px;';
        content.appendChild(this._statusEl);

        // Stats area
        this._statsEl = document.createElement('div');
        this._statsEl.style.cssText = 'line-height: 1.5;';
        this._statsEl.textContent = 'Waiting...';
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

        // Try snapshot buffer first (mirror/guest mode)
        if (game._snapshotBuffer) {
            const pair = game._snapshotBuffer.getInterpolationPair();
            if (pair.next) {
                this._renderUnits(pair.next.units, `tick ${pair.next.tick} | buf ${game._snapshotBuffer.size} | mirror`);
                return;
            }
        }

        // Fallback: read from local game.units (host mode)
        const localUnits = game.units?.filter(u => u);
        if (localUnits && localUnits.length > 0) {
            const unitData = localUnits.map(u => ({
                id: u.id,
                physicsMode: u.physicsMode || 'N/A',
                mode: u.mode || u.state || '?',
                altitude: u.altitude || 0,
                speed: u.speed || 0
            }));
            this._renderUnits(unitData, `local | ${localUnits.length} units`);
            return;
        }

        this._statsEl.textContent = 'No units yet (HOST + START first)';
    }

    /**
     * Render unit list to stats area.
     * @private
     */
    _renderUnits(units, headerText) {
        let html = `<div style="color:#888">${headerText}</div>`;

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

    /**
     * Show a status message that persists for 3 seconds (not overwritten by _update).
     * @private
     */
    _showStatus(msg, isError = false) {
        if (!this._statusEl) return;
        const color = isError ? '#f44' : '#0ff';
        this._statusEl.innerHTML = `<div style="color:${color};font-weight:bold">${msg}</div>`;
        if (this._statusTimer) clearTimeout(this._statusTimer);
        this._statusTimer = setTimeout(() => {
            this._statusEl.innerHTML = '';
        }, 3000);
    }

    /** @private */
    async _sendDevCommand(action, payload) {
        const sm = this.game.sessionManager;
        if (!sm || !sm.transport || !sm._sessionChannel) {
            this._showStatus('No active session! (HOST GAME first)', true);
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
        if (this._statusTimer) clearTimeout(this._statusTimer);
        if (this._el) this._el.remove();
    }
}
