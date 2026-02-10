/**
 * MultiplayerHUD.js - In-Game Multiplayer Status Panel
 *
 * R013: Compact always-visible HUD showing multiplayer session info:
 *   - Host name with crown icon
 *   - Host online/offline status
 *   - Player count
 *   - Room code (for sharing mid-game)
 *
 * Pattern: Self-contained DOM overlay (same pattern as JoinOverlay.js)
 * Position: top-right corner, below the dev HUD (if visible)
 * z-index: 10000 (below overlays at 25000, above game canvas)
 */

export class MultiplayerHUD {
    /**
     * @param {Object} game - Game instance reference
     */
    constructor(game) {
        if (!game) {
            throw new Error('MultiplayerHUD requires a game instance');
        }

        /** @type {Object} */
        this.game = game;

        /** @type {HTMLElement|null} */
        this._panel = null;

        /** @type {HTMLElement|null} */
        this._styleEl = null;

        /** @type {boolean} */
        this._visible = false;

        /** @type {number|null} Update timer ID */
        this._updateTimer = null;

        // DOM element references for fast update
        /** @type {HTMLElement|null} */
        this._hostNameEl = null;
        /** @type {HTMLElement|null} */
        this._statusDotEl = null;
        /** @type {HTMLElement|null} */
        this._statusTextEl = null;
        /** @type {HTMLElement|null} */
        this._playerCountEl = null;
        /** @type {HTMLElement|null} */
        this._roomCodeEl = null;
        /** @type {HTMLElement|null} */
        this._roleLabelEl = null;
        /** @type {HTMLElement|null} */
        this._myRoleEl = null;
        /** @type {HTMLElement|null} */
        this._myNameRowEl = null;
        /** @type {HTMLElement|null} */
        this._myNameEl = null;

        this._injectKeyframes();
        this._createPanel();
    }

    // ========================================
    // PUBLIC API
    // ========================================

    /**
     * Show the HUD with fade-in animation.
     * Starts the 500ms update timer.
     */
    show() {
        if (this._visible) return;
        this._visible = true;
        this._panel.style.display = 'block';
        // Trigger fade-in by forcing reflow then setting opacity
        this._panel.style.opacity = '0';
        void this._panel.offsetHeight; // force reflow
        this._panel.style.opacity = '1';

        // Immediate update then start timer
        this.update();
        this._startUpdateTimer();
    }

    /**
     * Hide the HUD and stop the update timer.
     */
    hide() {
        if (!this._visible) return;
        this._visible = false;
        this._panel.style.display = 'none';
        this._stopUpdateTimer();
    }

    /**
     * Refresh all HUD fields from current game/session state.
     * Called automatically every 500ms and on connection state changes.
     */
    update() {
        if (!this._panel) return;
        const sm = this.game.sessionManager;
        if (!sm) return;

        // Determine my role
        const myRole = sm.state.role; // 'HOST', 'GUEST', 'OFFLINE'

        // Host name: find slot 0 player (the host)
        const hostPlayer = sm.state.getPlayer(0);
        const hostName = hostPlayer?.displayName || 'Host';
        if (this._hostNameEl) {
            this._hostNameEl.textContent = hostName;
        }

        // Role label: show context-appropriate label
        if (this._roleLabelEl) {
            if (myRole === 'HOST') {
                this._roleLabelEl.textContent = 'You (Host):';
            } else if (myRole === 'GUEST') {
                this._roleLabelEl.textContent = 'Host:';
            } else {
                this._roleLabelEl.textContent = 'Offline';
            }
        }

        // Guest's own name row: visible only for Guest
        if (this._myNameRowEl) {
            if (myRole === 'GUEST') {
                this._myNameRowEl.style.display = 'flex';
                // Find my own player entry
                const myPlayer = sm.state.getPlayer(sm.state.mySlot);
                const myName = myPlayer?.displayName || this.game.playerName || 'Guest';
                if (this._myNameEl) {
                    this._myNameEl.textContent = myName;
                }
            } else {
                this._myNameRowEl.style.display = 'none';
            }
        }

        // Connection status: for Guest, check if we're connected (have session channel)
        const isConnected = myRole !== 'OFFLINE' && sm._sessionChannel !== null;
        if (this._statusDotEl) {
            this._statusDotEl.style.background = isConnected ? '#00ff88' : '#ff4444';
            this._statusDotEl.style.boxShadow = isConnected
                ? '0 0 6px rgba(0, 255, 136, 0.6)'
                : '0 0 6px rgba(255, 68, 68, 0.6)';
        }
        if (this._statusTextEl) {
            this._statusTextEl.textContent = isConnected ? 'Online' : 'Offline';
            this._statusTextEl.style.color = isConnected
                ? 'rgba(0, 255, 136, 0.8)'
                : 'rgba(255, 68, 68, 0.8)';
        }

        // Player count - hide when 0
        const players = sm.getPlayers();
        const playerCount = players ? players.length : 0;
        if (this._playerCountEl) {
            if (playerCount > 0) {
                this._playerCountEl.textContent = 'Players: ' + playerCount;
                this._playerCountEl.style.display = '';
            } else {
                this._playerCountEl.style.display = 'none';
            }
        }

        // Room code: extract from game.clientId or hostId (format: 'room-XX')
        const clientId = this.game.clientId || '';
        let roomCode = '--';
        if (clientId.startsWith('room-')) {
            roomCode = clientId.substring(5);
        } else {
            // Fallback: try hostId
            const hostId = sm.state.hostId || '';
            if (hostId.startsWith('room-')) {
                roomCode = hostId.substring(5);
            }
        }
        if (this._roomCodeEl) {
            this._roomCodeEl.textContent = 'Asteroida: ' + roomCode;
        }

        // My role badge
        if (this._myRoleEl) {
            this._myRoleEl.textContent = myRole;
            this._myRoleEl.style.color = myRole === 'HOST' ? '#00ff88' : myRole === 'GUEST' ? '#4488ff' : '#666';
        }
    }

    /**
     * Remove HUD from DOM, stop timers, release references.
     */
    destroy() {
        this._stopUpdateTimer();
        if (this._panel && this._panel.parentNode) {
            this._panel.parentNode.removeChild(this._panel);
        }
        if (this._styleEl && this._styleEl.parentNode) {
            this._styleEl.parentNode.removeChild(this._styleEl);
        }
        this._panel = null;
        this._styleEl = null;
        this._hostNameEl = null;
        this._statusDotEl = null;
        this._statusTextEl = null;
        this._playerCountEl = null;
        this._roomCodeEl = null;
        this._roleLabelEl = null;
        this._myRoleEl = null;
        this._myNameRowEl = null;
        this._myNameEl = null;
        this.game = null;
    }

    // ========================================
    // PRIVATE: KEYFRAME INJECTION
    // ========================================

    /**
     * Inject CSS keyframes for the fade-in animation.
     * @private
     */
    _injectKeyframes() {
        if (this._styleEl) return;
        const style = document.createElement('style');
        style.textContent = `
            @keyframes mpHudFadeIn {
                from { opacity: 0; transform: translateY(-6px); }
                to   { opacity: 1; transform: translateY(0); }
            }
        `;
        document.head.appendChild(style);
        this._styleEl = style;
    }

    // ========================================
    // PRIVATE: DOM CREATION
    // ========================================

    /**
     * Build the HUD panel and append to document body.
     * @private
     */
    _createPanel() {
        const panel = document.createElement('div');
        panel.id = 'mp-status-hud';
        panel.style.cssText = `
            position: fixed;
            top: 8px;
            right: 8px;
            background: rgba(10, 10, 25, 0.85);
            border: 1px solid rgba(0, 255, 136, 0.15);
            border-radius: 10px;
            padding: 12px 16px;
            min-width: 200px;
            z-index: 10000;
            font-family: 'Inter', 'Segoe UI', system-ui, sans-serif;
            user-select: none;
            pointer-events: none;
            display: none;
            opacity: 0;
            transition: opacity 0.35s ease;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4),
                        inset 0 1px 0 rgba(255, 255, 255, 0.03);
        `;

        // If dev HUD exists, push this panel below it
        const devHud = document.getElementById('r012-dev-hud');
        if (devHud) {
            // Measure dev HUD height and position below it with a gap
            const devRect = devHud.getBoundingClientRect();
            const offsetTop = devRect.bottom + 6;
            panel.style.top = offsetTop + 'px';
        }

        // --- Row 1: Host name with crown ---
        const hostRow = document.createElement('div');
        hostRow.style.cssText = `
            display: flex;
            align-items: center;
            gap: 6px;
            margin-bottom: 6px;
        `;

        const crownIcon = document.createElement('span');
        crownIcon.textContent = '\u265B'; // Unicode queen/crown character
        crownIcon.style.cssText = `
            color: #ffcc00;
            font-size: 14px;
            line-height: 1;
        `;

        const hostLabel = document.createElement('span');
        hostLabel.style.cssText = `
            color: rgba(255, 255, 255, 0.45);
            font-size: 11px;
            font-weight: 400;
        `;
        hostLabel.textContent = 'Host:';
        this._roleLabelEl = hostLabel;

        const hostName = document.createElement('span');
        hostName.style.cssText = `
            color: #00ff88;
            font-size: 13px;
            font-weight: 600;
            text-shadow: 0 0 8px rgba(0, 255, 136, 0.2);
        `;
        hostName.textContent = 'Host';
        this._hostNameEl = hostName;

        hostRow.appendChild(crownIcon);
        hostRow.appendChild(hostLabel);
        hostRow.appendChild(hostName);
        panel.appendChild(hostRow);

        // --- Row 1b: My name (visible for Guest, hidden for Host) ---
        const myNameRow = document.createElement('div');
        myNameRow.style.cssText = `
            display: none;
            align-items: center;
            gap: 6px;
            margin-bottom: 6px;
        `;
        this._myNameRowEl = myNameRow;

        const myNameIcon = document.createElement('span');
        myNameIcon.textContent = '\u2736'; // Six-pointed star
        myNameIcon.style.cssText = `
            color: #4488ff;
            font-size: 12px;
            line-height: 1;
        `;

        const myNameLabel = document.createElement('span');
        myNameLabel.style.cssText = `
            color: rgba(255, 255, 255, 0.45);
            font-size: 11px;
            font-weight: 400;
        `;
        myNameLabel.textContent = 'You:';

        const myNameVal = document.createElement('span');
        myNameVal.style.cssText = `
            color: #4488ff;
            font-size: 13px;
            font-weight: 600;
            text-shadow: 0 0 8px rgba(68, 136, 255, 0.2);
        `;
        myNameVal.textContent = '--';
        this._myNameEl = myNameVal;

        myNameRow.appendChild(myNameIcon);
        myNameRow.appendChild(myNameLabel);
        myNameRow.appendChild(myNameVal);
        panel.appendChild(myNameRow);

        // --- Row 2: Status dot + "Online" and Player count ---
        const statusRow = document.createElement('div');
        statusRow.style.cssText = `
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
            margin-bottom: 6px;
        `;

        // Left side: dot + status text
        const statusLeft = document.createElement('div');
        statusLeft.style.cssText = `
            display: flex;
            align-items: center;
            gap: 5px;
        `;

        const statusDot = document.createElement('span');
        statusDot.style.cssText = `
            display: inline-block;
            width: 7px;
            height: 7px;
            border-radius: 50%;
            background: #00ff88;
            box-shadow: 0 0 6px rgba(0, 255, 136, 0.6);
            flex-shrink: 0;
        `;
        this._statusDotEl = statusDot;

        const statusText = document.createElement('span');
        statusText.style.cssText = `
            color: rgba(0, 255, 136, 0.8);
            font-size: 11px;
            font-weight: 500;
        `;
        statusText.textContent = 'Online';
        this._statusTextEl = statusText;

        statusLeft.appendChild(statusDot);
        statusLeft.appendChild(statusText);

        // Right side: Player count
        const playerCount = document.createElement('span');
        playerCount.style.cssText = `
            color: rgba(255, 255, 255, 0.5);
            font-size: 11px;
            font-weight: 400;
        `;
        playerCount.textContent = 'Players: 0';
        this._playerCountEl = playerCount;

        statusRow.appendChild(statusLeft);
        statusRow.appendChild(playerCount);
        panel.appendChild(statusRow);

        // --- Row 3: Room code ---
        const roomRow = document.createElement('div');
        roomRow.style.cssText = `
            display: flex;
            align-items: center;
            gap: 6px;
        `;

        const roomCode = document.createElement('span');
        roomCode.style.cssText = `
            color: rgba(255, 255, 255, 0.4);
            font-size: 11px;
            font-weight: 400;
        `;
        roomCode.textContent = 'Asteroida: --';
        this._roomCodeEl = roomCode;

        roomRow.appendChild(roomCode);
        panel.appendChild(roomRow);

        // --- Row 4: My Role ---
        const roleRow = document.createElement('div');
        roleRow.style.cssText = `
            display: flex;
            align-items: center;
            gap: 6px;
            margin-top: 4px;
        `;
        const roleLabel = document.createElement('span');
        roleLabel.style.cssText = `
            color: rgba(255, 255, 255, 0.45);
            font-size: 11px;
            font-weight: 400;
        `;
        roleLabel.textContent = 'Role:';
        const myRoleEl = document.createElement('span');
        myRoleEl.style.cssText = `
            color: #4488ff;
            font-size: 11px;
            font-weight: 600;
        `;
        myRoleEl.textContent = '--';
        this._myRoleEl = myRoleEl;
        roleRow.appendChild(roleLabel);
        roleRow.appendChild(myRoleEl);
        panel.appendChild(roleRow);

        document.body.appendChild(panel);
        this._panel = panel;
    }

    // ========================================
    // PRIVATE: UPDATE TIMER
    // ========================================

    /**
     * Start the periodic update timer (500ms).
     * @private
     */
    _startUpdateTimer() {
        this._stopUpdateTimer();
        this._updateTimer = setInterval(() => {
            this.update();
        }, 500);
    }

    /**
     * Stop the periodic update timer.
     * @private
     */
    _stopUpdateTimer() {
        if (this._updateTimer !== null) {
            clearInterval(this._updateTimer);
            this._updateTimer = null;
        }
    }
}
