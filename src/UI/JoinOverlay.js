/**
 * JoinOverlay.js - Multiplayer Join UI Overlay
 *
 * R013: Provides Host/Guest role selection at startup when net=supabase.
 * Single-screen design with in-place transformations:
 *   State 'initial'  -> username + HOST GAME / JOIN GAME buttons
 *   State 'hosting'  -> username (editable) + Room code display / START GAME
 *   State 'joining'  -> username (editable) + Room code input / JOIN
 *
 * Pattern: Self-contained DOM overlay (same pattern as SeatKeypadOverlay.js)
 */

export class JoinOverlay {
    constructor() {
        /** @type {Function|null} callback(roomCode, username) */
        this.onHost = null;
        /** @type {Function|null} callback(roomCode, username) */
        this.onGuest = null;
        /** @type {Function|null} callback() - fired when host clicks START GAME */
        this.onStart = null;
        /** @type {Function|null} callback() - fired when user clicks SINGLE PLAYER */
        this.onSinglePlayer = null;

        this._overlay = null;
        this._card = null;
        this._visible = false;

        // State: 'initial' | 'hosting' | 'joining'
        this._state = 'initial';

        // Track injected style element for keyframes
        this._styleEl = null;

        // DOM references (persistent across state changes)
        this._usernameInput = null;
        this._playerCountEl = null;
        this._playerCountNum = null;
        this._leftSlot = null;
        this._rightSlot = null;
        this._errorEl = null;
        this._codeInput = null;
        this._spSlot = null;

        // State rebuild guard
        this._lastAppliedState = null;

        // Data
        this._roomCode = null;
        this._playerCount = 0;

        this._injectKeyframes();
        this._createOverlay();
        this._buildCard();
    }

    // ========================================
    // PUBLIC API
    // ========================================

    /**
     * Show the overlay
     */
    show() {
        this._visible = true;
        this._state = 'initial';
        this._lastAppliedState = null;
        this._playerCount = 0;
        this._roomCode = null;
        this._applyState();
        this._overlay.style.display = 'flex';
        // Reset username
        if (this._usernameInput) {
            this._usernameInput.value = '';
            setTimeout(() => this._usernameInput.focus(), 50);
        }
    }

    /**
     * Hide the overlay
     */
    hide() {
        this._visible = false;
        this._overlay.style.display = 'none';
    }

    /**
     * Show an error message on the current screen
     * @param {string} msg - Error text to display
     */
    showError(msg) {
        if (this._errorEl) {
            this._errorEl.textContent = msg;
            this._errorEl.style.color = '#ff4444';
            this._errorEl.style.display = 'block';
        }
    }

    /**
     * Check if overlay is visible
     * @returns {boolean}
     */
    get isVisible() {
        return this._visible;
    }

    /**
     * Update the displayed player count (called externally by Game.js)
     * @param {number} count
     */
    updatePlayerCount(count) {
        this._playerCount = count;
        if (this._playerCountEl) {
            this._playerCountEl.style.display = count > 0 ? 'flex' : 'none';
        }
        if (this._playerCountNum) {
            // Animate the count change
            this._playerCountNum.style.transition = 'none';
            this._playerCountNum.style.transform = 'scale(1.3)';
            this._playerCountNum.style.color = '#00ff88';
            this._playerCountNum.textContent = String(count);
            // Force reflow
            void this._playerCountNum.offsetHeight;
            this._playerCountNum.style.transition = 'transform 0.3s ease, color 0.5s ease';
            this._playerCountNum.style.transform = 'scale(1)';
            setTimeout(() => {
                if (this._playerCountNum) {
                    this._playerCountNum.style.color = 'rgba(255, 255, 255, 0.6)';
                }
            }, 600);
        }
    }

    /**
     * Update the wait text on host screen (e.g., when guest connects)
     * @param {string} text - New status text
     */
    setHostStatus(text) {
        // Legacy compat - use updatePlayerCount instead for counts
        // This can still set the error area as a status message
        if (this._errorEl) {
            this._errorEl.textContent = text;
            this._errorEl.style.color = 'rgba(255, 255, 255, 0.5)';
            this._errorEl.style.display = 'block';
        }
    }

    /**
     * Destroy the overlay and clean up
     */
    destroy() {
        if (this._overlay && this._overlay.parentNode) {
            this._overlay.parentNode.removeChild(this._overlay);
        }
        if (this._styleEl && this._styleEl.parentNode) {
            this._styleEl.parentNode.removeChild(this._styleEl);
        }
        this._overlay = null;
        this._styleEl = null;
    }

    // ========================================
    // PRIVATE: KEYFRAME INJECTION
    // ========================================

    /**
     * Inject CSS keyframes for animations into the document head
     * @private
     */
    _injectKeyframes() {
        if (this._styleEl) return;
        const style = document.createElement('style');
        style.textContent = `
            @keyframes joinOverlayFadeIn {
                from { opacity: 0; transform: scale(0.95) translateY(8px); }
                to   { opacity: 1; transform: scale(1) translateY(0); }
            }
            @keyframes joinOverlayBorderGlow {
                0%, 100% { border-color: rgba(120, 140, 180, 0.12); box-shadow: 0 0 40px rgba(100, 120, 160, 0.04), 0 8px 32px rgba(0, 0, 0, 0.6); }
                50%      { border-color: rgba(120, 140, 180, 0.22); box-shadow: 0 0 60px rgba(100, 120, 160, 0.08), 0 8px 32px rgba(0, 0, 0, 0.6); }
            }
            @keyframes joinOverlayCodePulse {
                0%, 100% { text-shadow: 0 0 30px rgba(0, 255, 136, 0.4), 0 0 60px rgba(0, 255, 136, 0.15); }
                50%      { text-shadow: 0 0 50px rgba(0, 255, 136, 0.7), 0 0 100px rgba(0, 255, 136, 0.3), 0 0 140px rgba(0, 255, 136, 0.1); }
            }
            @keyframes joinOverlaySlotFade {
                from { opacity: 0; transform: translateY(4px); }
                to   { opacity: 1; transform: translateY(0); }
            }
            @keyframes joinOverlayCountPop {
                0%   { transform: scale(1); }
                50%  { transform: scale(1.3); }
                100% { transform: scale(1); }
            }
        `;
        document.head.appendChild(style);
        this._styleEl = style;
    }

    // ========================================
    // PRIVATE: DOM CREATION
    // ========================================

    _createOverlay() {
        // Full-screen overlay
        const overlay = document.createElement('div');
        overlay.id = 'join-overlay';
        overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(3, 3, 10, 0.96);
            display: none;
            justify-content: center;
            align-items: center;
            z-index: 25000;
            font-family: 'Inter', 'Segoe UI', system-ui, sans-serif;
            user-select: none;
            backdrop-filter: blur(6px);
            -webkit-backdrop-filter: blur(6px);
        `;

        // Prevent game input while overlay is shown
        overlay.addEventListener('mousedown', (e) => e.stopPropagation());
        overlay.addEventListener('mouseup', (e) => e.stopPropagation());
        overlay.addEventListener('wheel', (e) => e.stopPropagation());
        overlay.addEventListener('keydown', (e) => e.stopPropagation());

        // Card container
        const card = document.createElement('div');
        card.style.cssText = `
            background: linear-gradient(165deg, rgba(20, 20, 40, 0.95) 0%, rgba(12, 12, 25, 0.98) 100%);
            border: 1px solid rgba(120, 140, 180, 0.12);
            border-radius: 20px;
            padding: 44px 40px 32px 40px;
            min-width: 360px;
            max-width: 420px;
            box-shadow:
                0 0 40px rgba(100, 120, 160, 0.04),
                0 8px 32px rgba(0, 0, 0, 0.6),
                inset 0 1px 0 rgba(255, 255, 255, 0.04);
            text-align: center;
            animation: joinOverlayFadeIn 0.35s cubic-bezier(0.22, 0.61, 0.36, 1) forwards,
                       joinOverlayBorderGlow 4s ease-in-out infinite;
            backdrop-filter: blur(12px);
            -webkit-backdrop-filter: blur(12px);
            position: relative;
        `;
        overlay.appendChild(card);

        document.body.appendChild(overlay);
        this._overlay = overlay;
        this._card = card;
    }

    /**
     * Build the single-card layout with all persistent sections.
     * Sections are shown/hidden based on state rather than rebuilding the DOM.
     * @private
     */
    _buildCard() {
        const card = this._card;
        card.innerHTML = '';

        // ---- Title ----
        const title = document.createElement('div');
        title.textContent = 'ASTEROBIA';
        title.style.cssText = `
            color: rgba(200, 200, 210, 0.85);
            font-size: 26px;
            font-weight: 300;
            letter-spacing: 8px;
            margin-bottom: 6px;
            text-shadow: 0 0 20px rgba(200, 200, 210, 0.1);
        `;
        card.appendChild(title);

        // ---- Subtitle ----
        const subtitle = document.createElement('div');
        subtitle.textContent = 'MULTIPLAYER';
        subtitle.style.cssText = `
            color: rgba(255, 255, 255, 0.25);
            font-size: 10px;
            font-weight: 300;
            letter-spacing: 5px;
            margin-bottom: 32px;
        `;
        card.appendChild(subtitle);

        // ---- Username label ----
        const usernameLabel = document.createElement('div');
        usernameLabel.textContent = 'YOUR NAME';
        usernameLabel.style.cssText = `
            color: rgba(255, 255, 255, 0.35);
            font-size: 10px;
            font-weight: 300;
            text-align: left;
            margin-bottom: 8px;
            letter-spacing: 2px;
        `;
        card.appendChild(usernameLabel);

        // ---- Username input ----
        const usernameInput = this._createInput('Commander');
        usernameInput.style.marginBottom = '20px';
        card.appendChild(usernameInput);
        this._usernameInput = usernameInput;

        // ---- Info row: room code + player count ----
        const infoRow = document.createElement('div');
        infoRow.style.cssText = `
            display: flex;
            justify-content: center;
            align-items: center;
            gap: 24px;
            margin-bottom: 20px;
            min-height: 28px;
        `;

        // Room display (shown in hosting state)
        this._roomDisplay = document.createElement('div');
        this._roomDisplay.style.cssText = `
            display: none;
            align-items: center;
            gap: 8px;
        `;
        const roomLabel = document.createElement('span');
        roomLabel.textContent = 'Asteroida:';
        roomLabel.style.cssText = `
            color: rgba(255, 255, 255, 0.35);
            font-size: 12px;
            font-weight: 300;
            letter-spacing: 1px;
        `;
        this._roomCodeLabel = document.createElement('span');
        this._roomCodeLabel.style.cssText = `
            color: #00ff88;
            font-size: 20px;
            font-weight: 600;
            letter-spacing: 4px;
            text-shadow: 0 0 20px rgba(0, 255, 136, 0.3);
            animation: joinOverlayCodePulse 2.5s ease-in-out infinite;
            font-variant-numeric: tabular-nums;
        `;
        this._roomDisplay.appendChild(roomLabel);
        this._roomDisplay.appendChild(this._roomCodeLabel);
        infoRow.appendChild(this._roomDisplay);

        // Player count
        const playerCountEl = document.createElement('div');
        playerCountEl.style.cssText = `
            display: flex;
            align-items: center;
            gap: 6px;
        `;
        const playersLabel = document.createElement('span');
        playersLabel.textContent = 'Players:';
        playersLabel.style.cssText = `
            color: rgba(255, 255, 255, 0.35);
            font-size: 12px;
            font-weight: 300;
            letter-spacing: 1px;
        `;
        const playerCountNum = document.createElement('span');
        playerCountNum.textContent = '0';
        playerCountNum.style.cssText = `
            color: rgba(255, 255, 255, 0.6);
            font-size: 16px;
            font-weight: 500;
            font-variant-numeric: tabular-nums;
            display: inline-block;
            min-width: 18px;
            text-align: center;
        `;
        playerCountEl.appendChild(playersLabel);
        playerCountEl.appendChild(playerCountNum);
        infoRow.appendChild(playerCountEl);

        card.appendChild(infoRow);
        this._playerCountEl = playerCountEl;
        this._playerCountNum = playerCountNum;

        // ---- Divider ----
        const divider = document.createElement('div');
        divider.style.cssText = `
            width: 100%;
            height: 1px;
            background: linear-gradient(90deg, transparent 0%, rgba(120, 140, 180, 0.12) 30%, rgba(120, 140, 180, 0.12) 70%, transparent 100%);
            margin-bottom: 20px;
        `;
        card.appendChild(divider);

        // ---- Button row (two slots) ----
        const btnRow = document.createElement('div');
        btnRow.style.cssText = `
            display: flex;
            gap: 16px;
        `;

        const leftSlot = document.createElement('div');
        leftSlot.style.cssText = `flex: 1; display: flex;`;
        const rightSlot = document.createElement('div');
        rightSlot.style.cssText = `flex: 1; display: flex;`;

        btnRow.appendChild(leftSlot);
        btnRow.appendChild(rightSlot);
        card.appendChild(btnRow);
        this._leftSlot = leftSlot;
        this._rightSlot = rightSlot;

        // ---- Single Player row ----
        const spRow = document.createElement('div');
        spRow.style.cssText = `display: flex; margin-top: 12px;`;
        this._spSlot = spRow;
        card.appendChild(spRow);

        // ---- Error area (hidden by default) ----
        const errorEl = document.createElement('div');
        errorEl.style.cssText = `
            color: #ff4444;
            font-size: 12px;
            font-weight: 300;
            margin-top: 16px;
            display: none;
            min-height: 20px;
        `;
        card.appendChild(errorEl);
        this._errorEl = errorEl;

        // ---- Version footer ----
        card.appendChild(this._createFooter());
    }

    // ========================================
    // STATE MANAGEMENT
    // ========================================

    /**
     * Apply visual state without rebuilding the DOM.
     * Shows/hides elements and swaps button slot contents.
     * @private
     */
    _applyState() {
        // Don't rebuild if state hasn't changed (prevents input focus loss)
        if (this._state === this._lastAppliedState) {
            return;
        }
        this._lastAppliedState = this._state;

        // Clear error
        if (this._errorEl) {
            this._errorEl.style.display = 'none';
            this._errorEl.textContent = '';
        }

        // Clear button slots
        this._leftSlot.innerHTML = '';
        this._rightSlot.innerHTML = '';

        // Reset code input ref
        this._codeInput = null;

        // Clear single player slot
        if (this._spSlot) {
            this._spSlot.innerHTML = '';
        }

        switch (this._state) {
            case 'initial':
                this._applyInitialState();
                break;
            case 'hosting':
                this._applyHostingState();
                break;
            case 'joining':
                this._applyJoiningState();
                break;
        }

        // Animate the slots in
        this._leftSlot.style.animation = 'joinOverlaySlotFade 0.25s ease forwards';
        this._rightSlot.style.animation = 'joinOverlaySlotFade 0.25s ease forwards';
    }

    /**
     * State: initial - HOST GAME / JOIN GAME buttons
     * @private
     */
    _applyInitialState() {
        // Hide room display
        this._roomDisplay.style.display = 'none';

        // Hide player count in initial state
        this._playerCountEl.style.display = 'none';
        this._playerCountNum.textContent = '0';

        // Show single player row
        if (this._spSlot) {
            this._spSlot.style.display = 'flex';
        }

        // Left: HOST GAME button
        const hostBtn = this._createButton('HOST GAME', '#00ff88', () => {
            // Generate room code (10-99)
            this._roomCode = Math.floor(Math.random() * 90) + 10;
            this._state = 'hosting';
            this._applyState();

            // Fire callback immediately
            const username = this._usernameInput.value.trim() || 'Host';
            if (this.onHost) {
                this.onHost(this._roomCode, username);
            }
        });
        this._leftSlot.appendChild(hostBtn);

        // Right: JOIN GAME button
        const joinBtn = this._createButton('JOIN GAME', '#4488ff', () => {
            this._state = 'joining';
            this._lastAppliedState = null; // Force rebuild for joining state
            this._applyState();
        });
        this._rightSlot.appendChild(joinBtn);

        // Single Player button in spSlot
        if (this._spSlot) {
            const spBtn = this._createButton('SINGLE PLAYER', '#666', () => {
                if (this.onSinglePlayer) {
                    this.onSinglePlayer();
                }
                this.hide();
            });
            this._spSlot.appendChild(spBtn);
        }
    }

    /**
     * State: hosting - Room code display / START GAME button
     * @private
     */
    _applyHostingState() {
        // Show room display with code
        this._roomDisplay.style.display = 'flex';
        this._roomCodeLabel.textContent = String(this._roomCode);

        // Hide single player row
        if (this._spSlot) {
            this._spSlot.style.display = 'none';
        }

        // Show player count only if > 0
        this._playerCountEl.style.display = this._playerCount > 0 ? 'flex' : 'none';

        // Left slot: Room code badge (big, green, glowing)
        const roomBadge = document.createElement('div');
        roomBadge.style.cssText = `
            flex: 1;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 10px;
            padding: 14px 16px;
            background: linear-gradient(180deg, rgba(0, 255, 136, 0.10) 0%, rgba(0, 255, 136, 0.04) 100%);
            border: 1px solid rgba(0, 255, 136, 0.30);
            border-radius: 12px;
            animation: joinOverlayCodePulse 2.5s ease-in-out infinite;
        `;
        const roomBadgeLabel = document.createElement('span');
        roomBadgeLabel.textContent = 'Asteroida:';
        roomBadgeLabel.style.cssText = `
            color: rgba(0, 255, 136, 0.5);
            font-size: 12px;
            font-weight: 300;
            letter-spacing: 1px;
        `;
        const roomBadgeCode = document.createElement('span');
        roomBadgeCode.textContent = String(this._roomCode);
        roomBadgeCode.style.cssText = `
            color: #00ff88;
            font-size: 22px;
            font-weight: 700;
            letter-spacing: 6px;
            font-variant-numeric: tabular-nums;
        `;
        roomBadge.appendChild(roomBadgeLabel);
        roomBadge.appendChild(roomBadgeCode);
        this._leftSlot.appendChild(roomBadge);

        // Right slot: START GAME button (bright green, prominent)
        const startBtn = this._createButton('START GAME', '#00ff88', () => {
            if (this.onStart) {
                this.onStart();
            }
            this.hide();
        });
        // Make it more prominent
        startBtn.style.fontSize = '13px';
        startBtn.style.letterSpacing = '3px';
        startBtn.style.background = 'linear-gradient(180deg, rgba(0, 255, 136, 0.18) 0%, rgba(0, 255, 136, 0.08) 100%)';
        startBtn.style.borderColor = 'rgba(0, 255, 136, 0.35)';
        startBtn.style.boxShadow = '0 4px 16px rgba(0, 255, 136, 0.12)';
        this._rightSlot.appendChild(startBtn);
    }

    /**
     * State: joining - Room code input / JOIN button
     * @private
     */
    _applyJoiningState() {
        // Hide room display
        this._roomDisplay.style.display = 'none';

        // Hide player count in joining state
        this._playerCountEl.style.display = 'none';

        // Left slot: Room code input
        const inputWrapper = document.createElement('div');
        inputWrapper.style.cssText = `
            flex: 1;
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 4px 10px;
            background: linear-gradient(180deg, rgba(0, 0, 0, 0.3) 0%, rgba(0, 0, 0, 0.18) 100%);
            border: 1px solid rgba(68, 136, 255, 0.30);
            border-radius: 12px;
            transition: border-color 0.25s, box-shadow 0.25s;
        `;

        const inputLabel = document.createElement('span');
        inputLabel.textContent = 'Asteroida:';
        inputLabel.style.cssText = `
            color: rgba(68, 136, 255, 0.5);
            font-size: 12px;
            font-weight: 300;
            letter-spacing: 1px;
            white-space: nowrap;
        `;

        const codeInput = document.createElement('input');
        codeInput.type = 'text';
        codeInput.maxLength = 2;
        codeInput.placeholder = '__';
        codeInput.inputMode = 'numeric';
        codeInput.pattern = '[0-9]*';
        codeInput.style.cssText = `
            width: 60px;
            background: transparent;
            border: none;
            color: #4488ff;
            font-size: 24px;
            font-weight: 700;
            text-align: center;
            padding: 8px 2px;
            outline: none;
            letter-spacing: 6px;
            font-variant-numeric: tabular-nums;
            caret-color: #4488ff;
            user-select: text;
            -webkit-user-select: text;
        `;
        // Prevent game engine from intercepting input events (same as username input)
        codeInput.addEventListener('mousedown', (e) => {
            e.stopPropagation();
        });
        codeInput.addEventListener('click', (e) => {
            e.stopPropagation();
            codeInput.focus();
        });
        codeInput.addEventListener('keyup', (e) => {
            e.stopPropagation();
        });
        // Only allow digits
        codeInput.addEventListener('input', () => {
            codeInput.value = codeInput.value.replace(/[^0-9]/g, '');
        });
        // Enter key submits
        codeInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                this._doJoin();
            }
            e.stopPropagation();
        });
        // Focus effects on wrapper
        codeInput.addEventListener('focus', () => {
            inputWrapper.style.borderColor = 'rgba(68, 136, 255, 0.6)';
            inputWrapper.style.boxShadow = '0 0 16px rgba(68, 136, 255, 0.1), inset 0 0 8px rgba(68, 136, 255, 0.03)';
        });
        codeInput.addEventListener('blur', () => {
            inputWrapper.style.borderColor = 'rgba(68, 136, 255, 0.30)';
            inputWrapper.style.boxShadow = 'none';
        });

        inputWrapper.appendChild(inputLabel);
        inputWrapper.appendChild(codeInput);
        this._leftSlot.appendChild(inputWrapper);
        this._codeInput = codeInput;

        // Right slot: JOIN button
        const joinBtn = this._createButton('JOIN \u2192', '#4488ff', () => {
            this._doJoin();
        });
        this._rightSlot.appendChild(joinBtn);

        // Show back button in spSlot
        if (this._spSlot) {
            this._spSlot.style.display = 'flex';
            const backBtn = this._createButton('\u2190 BACK', '#666', () => {
                this._state = 'initial';
                this._lastAppliedState = null; // Force rebuild for initial state
                this._applyState();
            });
            this._spSlot.appendChild(backBtn);
        }

        // Focus code input
        setTimeout(() => codeInput.focus(), 50);
    }

    /**
     * Validate and fire join callback
     * @private
     */
    _doJoin() {
        const code = this._codeInput ? this._codeInput.value.trim() : '';

        // Validate: must be 2 digits, 10-99
        const codeNum = parseInt(code, 10);
        if (isNaN(codeNum) || codeNum < 10 || codeNum > 99) {
            this.showError('Enter a valid 2-digit code (10-99)');
            return;
        }

        // Clear error
        if (this._errorEl) {
            this._errorEl.style.display = 'none';
        }

        // Show connecting state
        this._showConnectingState();

        const username = this._usernameInput.value.trim() || 'Guest';
        if (this.onGuest) {
            this.onGuest(codeNum, username);
        }
    }

    /**
     * Show a brief connecting indicator
     * @private
     */
    _showConnectingState() {
        if (this._errorEl) {
            this._errorEl.textContent = 'Connecting...';
            this._errorEl.style.color = 'rgba(255, 255, 255, 0.5)';
            this._errorEl.style.display = 'block';
        }
    }

    // ========================================
    // PRIVATE: UI HELPERS
    // ========================================

    /**
     * Create a styled input field
     * @private
     * @param {string} placeholder
     * @returns {HTMLInputElement}
     */
    _createInput(placeholder) {
        const input = document.createElement('input');
        input.type = 'text';
        input.placeholder = placeholder;
        input.maxLength = 20;
        input.setAttribute('tabindex', '0');
        input.style.cssText = `
            width: 100%;
            background: linear-gradient(180deg, rgba(0, 0, 0, 0.3) 0%, rgba(0, 0, 0, 0.18) 100%);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 10px;
            color: #fff;
            font-size: 14px;
            font-weight: 300;
            padding: 11px 14px;
            outline: none;
            box-sizing: border-box;
            transition: border-color 0.25s, box-shadow 0.25s;
            user-select: text;
            -webkit-user-select: text;
            pointer-events: auto;
            box-shadow: 0 0 0 rgba(100, 120, 160, 0);
        `;

        // Prevent game engine from intercepting input events
        input.addEventListener('mousedown', (e) => {
            e.stopPropagation();
        });
        input.addEventListener('click', (e) => {
            e.stopPropagation();
            input.focus();
        });
        input.addEventListener('keydown', (e) => {
            e.stopPropagation();
        });
        input.addEventListener('keyup', (e) => {
            e.stopPropagation();
        });

        input.addEventListener('focus', () => {
            input.style.borderColor = 'rgba(120, 140, 180, 0.35)';
            input.style.boxShadow = '0 0 12px rgba(100, 120, 160, 0.06)';
        });
        input.addEventListener('blur', () => {
            input.style.borderColor = 'rgba(255, 255, 255, 0.1)';
            input.style.boxShadow = '0 0 0 rgba(100, 120, 160, 0)';
        });
        return input;
    }

    /**
     * Create a styled button
     * @private
     * @param {string} label
     * @param {string} accentColor - Hex color for the button accent
     * @param {Function} onClick
     * @returns {HTMLButtonElement}
     */
    _createButton(label, accentColor, onClick) {
        const btn = document.createElement('button');
        btn.textContent = label;

        const isAccent = accentColor !== '#666';
        const rgb = this._hexToRgb(accentColor);
        const bgColor = isAccent
            ? `linear-gradient(180deg, rgba(${rgb}, 0.10) 0%, rgba(${rgb}, 0.05) 100%)`
            : 'linear-gradient(180deg, rgba(100, 100, 100, 0.15) 0%, rgba(100, 100, 100, 0.08) 100%)';
        const borderColor = isAccent
            ? `rgba(${rgb}, 0.25)`
            : 'rgba(100, 100, 100, 0.25)';
        const hoverBg = isAccent
            ? `linear-gradient(180deg, rgba(${rgb}, 0.18) 0%, rgba(${rgb}, 0.10) 100%)`
            : 'linear-gradient(180deg, rgba(100, 100, 100, 0.28) 0%, rgba(100, 100, 100, 0.15) 100%)';
        const shadowColor = isAccent
            ? `rgba(${rgb}, 0.10)`
            : 'rgba(0, 0, 0, 0.15)';

        btn.style.cssText = `
            flex: 1;
            padding: 14px 20px;
            background: ${bgColor};
            color: ${accentColor === '#666' ? '#aaa' : accentColor};
            border: 1px solid ${borderColor};
            border-radius: 12px;
            font-size: 12px;
            font-weight: 500;
            letter-spacing: 2px;
            cursor: pointer;
            transition: all 0.2s ease;
            box-shadow: 0 2px 12px ${shadowColor};
            text-shadow: ${isAccent ? `0 0 10px rgba(${rgb}, 0.2)` : 'none'};
        `;

        btn.addEventListener('mouseenter', () => {
            btn.style.background = hoverBg;
            btn.style.transform = 'translateY(-1px)';
            btn.style.boxShadow = `0 4px 20px ${shadowColor}`;
        });
        btn.addEventListener('mouseleave', () => {
            btn.style.background = bgColor;
            btn.style.transform = 'translateY(0)';
            btn.style.boxShadow = `0 2px 12px ${shadowColor}`;
        });
        btn.addEventListener('mousedown', () => {
            btn.style.transform = 'scale(0.97)';
        });
        btn.addEventListener('mouseup', () => {
            btn.style.transform = 'scale(1)';
        });
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            onClick();
        });

        return btn;
    }

    /**
     * Create a version footer element
     * @private
     * @returns {HTMLDivElement}
     */
    _createFooter() {
        const footer = document.createElement('div');
        footer.textContent = 'v0.13 alpha';
        footer.style.cssText = `
            color: rgba(255, 255, 255, 0.12);
            font-size: 10px;
            font-weight: 300;
            letter-spacing: 2px;
            margin-top: 24px;
            text-transform: uppercase;
        `;
        return footer;
    }

    /**
     * Escape HTML entities in a string for safe innerHTML usage
     * @private
     * @param {string} str
     * @returns {string}
     */
    _escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    /**
     * Convert hex color to rgb values string
     * @private
     * @param {string} hex - Hex color like '#00ff88'
     * @returns {string} '0, 255, 136'
     */
    _hexToRgb(hex) {
        const h = hex.replace('#', '');
        const r = parseInt(h.substring(0, 2), 16);
        const g = parseInt(h.substring(2, 4), 16);
        const b = parseInt(h.substring(4, 6), 16);
        return `${r}, ${g}, ${b}`;
    }
}
