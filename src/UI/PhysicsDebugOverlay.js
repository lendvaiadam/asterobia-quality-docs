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

        // Altitude slider — sets selected unit height above terrain
        const altRow = document.createElement('div');
        altRow.style.cssText = 'display: flex; align-items: center; gap: 4px; margin-bottom: 6px;';
        const altLabel = document.createElement('span');
        altLabel.style.cssText = 'color: #0af; font-size: 10px; white-space: nowrap;';
        altLabel.textContent = 'ALT:';
        this._altSlider = document.createElement('input');
        this._altSlider.type = 'range'; this._altSlider.min = '0'; this._altSlider.max = '30'; this._altSlider.value = '10';
        this._altSlider.style.cssText = 'flex: 1; height: 14px; cursor: pointer; accent-color: #0af;';
        this._altValue = document.createElement('span');
        this._altValue.style.cssText = 'color: #0af; font-size: 10px; min-width: 28px; text-align: right;';
        this._altValue.textContent = '10m';
        this._altSlider.addEventListener('input', () => { this._altValue.textContent = this._altSlider.value + 'm'; });
        this._altSlider.addEventListener('change', () => {
            const unit = this.game.selectedUnit;
            if (!unit) { this._showStatus('Select a unit first!', true); return; }
            const p = unit.mesh ? unit.mesh.position : unit.position;
            const q = unit.mesh ? unit.mesh.quaternion : null;
            const payload = { unitId: unit.id, altitude: parseFloat(this._altSlider.value), px: p.x, py: p.y, pz: p.z };
            if (q) { payload.qx = q.x; payload.qy = q.y; payload.qz = q.z; payload.qw = q.w; }
            this._sendDevCommand('SET_ALTITUDE', payload);
            this._showStatus(`ALT ${this._altSlider.value}m → U${unit.id}`);
        });
        altRow.appendChild(altLabel); altRow.appendChild(this._altSlider); altRow.appendChild(this._altValue);
        content.appendChild(altRow);

        // Rapier ON/OFF toggle + DROP
        const rapierRow = document.createElement('div');
        rapierRow.style.cssText = 'display: flex; gap: 4px; margin-bottom: 6px;';
        this._rapierBtn = this._makeButton('RAPIER ON', '#0a0', () => this._toggleRapier(true));
        this._rapierOffBtn = this._makeButton('RAPIER OFF', '#f44', () => this._toggleRapier(false));
        const btnDrop = this._makeButton('DROP', '#0af', () => this._dropTest());
        rapierRow.appendChild(this._rapierBtn); rapierRow.appendChild(this._rapierOffBtn); rapierRow.appendChild(btnDrop);
        content.appendChild(rapierRow);

        // Buttons row
        const btnRow = document.createElement('div');
        btnRow.style.cssText = 'display: flex; gap: 4px; margin-bottom: 6px;';

        const btnExplode = this._makeButton('EXPLODE', '#f44', () => this._triggerExplosion());
        btnRow.appendChild(btnExplode);
        content.appendChild(btnRow);

        // Rollover threshold slider row
        const threshRow = document.createElement('div');
        threshRow.style.cssText = 'display: flex; align-items: center; gap: 4px; margin-bottom: 6px;';
        const threshLabel = document.createElement('span');
        threshLabel.style.cssText = 'color: #ff0; font-size: 10px; white-space: nowrap;';
        threshLabel.textContent = 'ROLLOVER:';
        const threshSlider = document.createElement('input');
        threshSlider.type = 'range';
        threshSlider.min = '5';
        threshSlider.max = '90';
        threshSlider.value = '25';
        threshSlider.style.cssText = 'flex: 1; height: 14px; cursor: pointer; accent-color: #ff0;';
        const threshValue = document.createElement('span');
        threshValue.style.cssText = 'color: #ff0; font-size: 10px; min-width: 28px; text-align: right;';
        threshValue.textContent = '25°';
        threshSlider.addEventListener('input', () => {
            const deg = parseInt(threshSlider.value, 10);
            threshValue.textContent = `${deg}°`;
        });
        threshSlider.addEventListener('change', () => {
            const deg = parseInt(threshSlider.value, 10);
            this._sendDevCommand('SET_ROLLOVER_THRESHOLD', { degrees: deg });
            this._showStatus(`Rollover threshold → ${deg}°`);
        });
        threshRow.appendChild(threshLabel);
        threshRow.appendChild(threshSlider);
        threshRow.appendChild(threshValue);
        content.appendChild(threshRow);

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
        const game = this.game;
        const sm = game.sessionManager;
        const snapCount = sm?._debugCounters?.serverSnapshotRecvCount || 0;
        const session = sm?._sessionChannel ? 'YES' : 'NO';
        const mirror = game._mirrorMode ? 'YES' : 'NO';
        let html = `<div style="color:#888">${headerText}</div>`;
        html += `<div style="color:#666">session:${session} mirror:${mirror} snaps:${snapCount}</div>`;

        for (const u of units) {
            const mode = u._serverPhysicsMode || u.physicsMode || 'N/A';
            const isDynamic = mode === 'DYNAMIC';
            const isSettled = mode === 'SETTLED';
            const color = isDynamic ? '#f44' : isSettled ? '#ff0' : '#0f0';
            const stateLabel = u.mode || u.state || '?';
            const serverTag = u._serverDriven ? ' (srv)' : '';
            html += `<div style="color:${color}">` +
                `U${u.id} [${mode}]${serverTag} ${stateLabel} ` +
                `alt:${(u.altitude || 0).toFixed(1)} ` +
                `spd:${(u.speed || 0).toFixed(1)}` +
                `</div>`;
        }

        this._statsEl.innerHTML = html;
    }

    /** @private */
    _toggleRapier(enable) {
        const unit = this.game.selectedUnit;
        if (!unit) { this._showStatus('Select a unit first!', true); return; }
        const p = unit.mesh ? unit.mesh.position : unit.position;
        const q = unit.mesh ? unit.mesh.quaternion : null;
        const payload = { unitId: unit.id, enable, px: p.x, py: p.y, pz: p.z };
        if (q) { payload.qx = q.x; payload.qy = q.y; payload.qz = q.z; payload.qw = q.w; }
        this._sendDevCommand('TOGGLE_RAPIER', payload);
        this._showStatus(`RAPIER ${enable ? 'ON' : 'OFF'} → U${unit.id}`);
    }

    /** @private */
    _dropTest() {
        const game = this.game;
        const unit = game.selectedUnit;
        if (!unit) {
            this._showStatus('Select a unit first! (double-click)', true);
            return;
        }
        const p = unit.mesh ? unit.mesh.position : unit.position;
        const q = unit.mesh ? unit.mesh.quaternion : null;
        const payload = { unitId: unit.id, px: p.x, py: p.y, pz: p.z };
        if (q) { payload.qx = q.x; payload.qy = q.y; payload.qz = q.z; payload.qw = q.w; }
        this._sendDevCommand('DROP_TEST', payload);
        this._showStatus(`DROP sent → U${unit.id}`);
    }

    /** @private */
    _toggleUnitPhysics() {
        const game = this.game;
        const unit = game.selectedUnit;
        if (!unit) {
            this._showStatus('Select a unit first! (double-click)', true);
            return;
        }
        this._sendDevCommand('TOGGLE_UNIT_PHYSICS', { unitId: unit.id });
        this._showStatus(`Physics toggle sent → U${unit.id}`);
    }

    /** @private */
    _triggerExplosion() {
        const game = this.game;
        const unit = game.selectedUnit;
        if (!unit) {
            this._showStatus('Select a unit first! (double-click)', true);
            return;
        }
        const p = unit.mesh ? unit.mesh.position : unit.position;
        const q = unit.mesh ? unit.mesh.quaternion : null;
        const payload = { unitId: unit.id, radius: 8, strength: 80, px: p.x, py: p.y, pz: p.z };
        if (q) { payload.qx = q.x; payload.qy = q.y; payload.qz = q.z; payload.qw = q.w; }
        this._sendDevCommand('TRIGGER_EXPLOSION', payload);
        this._showStatus(`EXPLODE sent → U${unit.id}`);
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
