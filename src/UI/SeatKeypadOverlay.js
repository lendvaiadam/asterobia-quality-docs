/**
 * SeatKeypadOverlay - PIN entry keypad overlay for protected units
 *
 * GAP-0: Provides a visual keypad (1-9) for seat protection PIN entry.
 * Shows error messages with countdown timer during cooldown periods.
 */

/**
 * Creates a lock icon (emoji-based for simplicity and cross-platform support)
 * @returns {string} Lock icon character
 */
export function createLockIcon() {
    return '\u{1F512}'; // Unicode for locked padlock emoji
}

export class SeatKeypadOverlay {
    /**
     * @param {object} game - Game instance reference
     */
    constructor(game) {
        this.game = game;
        this._visible = false;
        this._overlay = null;
        this._buttonsContainer = null;
        this._feedbackArea = null;
        this._titleElement = null;
        this._cancelButton = null;
        this._countdownInterval = null;
        this._onSubmit = null;
        this._targetUnitId = null;
        this._buttonsDisabled = false;

        this._createOverlay();
    }

    /**
     * Creates the DOM structure for the keypad overlay
     * @private
     */
    _createOverlay() {
        // Main overlay container
        const overlay = document.createElement('div');
        overlay.id = 'seat-keypad-overlay';
        overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.8);
            display: none;
            justify-content: center;
            align-items: center;
            z-index: 20000;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        `;

        // Keypad container (centered box)
        const keypadBox = document.createElement('div');
        keypadBox.style.cssText = `
            background: rgba(30, 30, 30, 0.95);
            border: 2px solid #444;
            border-radius: 12px;
            padding: 24px;
            min-width: 220px;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
        `;

        // Title
        const title = document.createElement('div');
        title.style.cssText = `
            color: #fff;
            font-size: 18px;
            font-weight: 600;
            text-align: center;
            margin-bottom: 20px;
        `;
        title.textContent = 'Enter PIN (1-9)';
        this._titleElement = title;

        // Buttons grid (3x3)
        const buttonsContainer = document.createElement('div');
        buttonsContainer.style.cssText = `
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 10px;
            margin-bottom: 16px;
        `;

        // Create buttons 1-9
        for (let i = 1; i <= 9; i++) {
            const btn = this._createDigitButton(i);
            buttonsContainer.appendChild(btn);
        }
        this._buttonsContainer = buttonsContainer;

        // Feedback area (for error messages and countdown)
        const feedbackArea = document.createElement('div');
        feedbackArea.style.cssText = `
            color: #ff4444;
            font-size: 14px;
            text-align: center;
            min-height: 20px;
            margin-bottom: 12px;
        `;
        this._feedbackArea = feedbackArea;

        // Cancel button
        const cancelButton = document.createElement('button');
        cancelButton.textContent = 'Cancel';
        cancelButton.style.cssText = `
            width: 100%;
            padding: 12px;
            background: rgba(100, 100, 100, 0.5);
            color: #ccc;
            border: 1px solid #555;
            border-radius: 6px;
            font-size: 14px;
            cursor: pointer;
            transition: background 0.2s, color 0.2s;
        `;
        cancelButton.addEventListener('mouseenter', () => {
            cancelButton.style.background = 'rgba(100, 100, 100, 0.7)';
            cancelButton.style.color = '#fff';
        });
        cancelButton.addEventListener('mouseleave', () => {
            cancelButton.style.background = 'rgba(100, 100, 100, 0.5)';
            cancelButton.style.color = '#ccc';
        });
        cancelButton.addEventListener('click', (e) => {
            e.stopPropagation();
            this.hide();
        });
        this._cancelButton = cancelButton;

        // Assemble the structure
        keypadBox.appendChild(title);
        keypadBox.appendChild(buttonsContainer);
        keypadBox.appendChild(feedbackArea);
        keypadBox.appendChild(cancelButton);
        overlay.appendChild(keypadBox);

        // Click on overlay background to cancel
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                this.hide();
            }
        });

        // Prevent event propagation to game
        overlay.addEventListener('mousedown', (e) => e.stopPropagation());
        overlay.addEventListener('mouseup', (e) => e.stopPropagation());
        overlay.addEventListener('wheel', (e) => e.stopPropagation());

        // Keyboard support
        overlay.addEventListener('keydown', (e) => {
            e.stopPropagation();
            if (e.key === 'Escape') {
                this.hide();
            } else if (e.key >= '1' && e.key <= '9' && !this._buttonsDisabled) {
                this._handleDigitClick(parseInt(e.key, 10));
            }
        });

        document.body.appendChild(overlay);
        this._overlay = overlay;
    }

    /**
     * Creates a single digit button
     * @private
     * @param {number} digit - The digit (1-9)
     * @returns {HTMLButtonElement}
     */
    _createDigitButton(digit) {
        const btn = document.createElement('button');
        btn.textContent = String(digit);
        btn.dataset.digit = digit;
        btn.style.cssText = `
            width: 50px;
            height: 50px;
            font-size: 20px;
            font-weight: 600;
            background: rgba(70, 70, 70, 0.8);
            color: #fff;
            border: 1px solid #555;
            border-radius: 8px;
            cursor: pointer;
            transition: background 0.15s, transform 0.1s;
            user-select: none;
        `;

        btn.addEventListener('mouseenter', () => {
            if (!this._buttonsDisabled) {
                btn.style.background = 'rgba(100, 100, 100, 0.9)';
            }
        });
        btn.addEventListener('mouseleave', () => {
            btn.style.background = this._buttonsDisabled
                ? 'rgba(50, 50, 50, 0.5)'
                : 'rgba(70, 70, 70, 0.8)';
        });
        btn.addEventListener('mousedown', () => {
            if (!this._buttonsDisabled) {
                btn.style.transform = 'scale(0.95)';
            }
        });
        btn.addEventListener('mouseup', () => {
            btn.style.transform = 'scale(1)';
        });
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (!this._buttonsDisabled) {
                this._handleDigitClick(digit);
            }
        });

        return btn;
    }

    /**
     * Handles digit button click
     * @private
     * @param {number} digit - The digit pressed (1-9)
     */
    _handleDigitClick(digit) {
        if (this._onSubmit && !this._buttonsDisabled) {
            this._onSubmit(digit);
        }
    }

    /**
     * Shows the keypad overlay
     * @param {string} targetUnitId - ID of the unit being unlocked
     * @param {function} onSubmit - Callback called with digit (1-9) when user clicks a button
     */
    show(targetUnitId, onSubmit) {
        this._targetUnitId = targetUnitId;
        this._onSubmit = onSubmit;
        this._clearFeedback();
        this._enableButtons();

        this._overlay.style.display = 'flex';
        this._visible = true;

        // Focus the overlay for keyboard input
        this._overlay.tabIndex = -1;
        this._overlay.focus();
    }

    /**
     * Hides the keypad overlay
     */
    hide() {
        this._overlay.style.display = 'none';
        this._visible = false;
        this._onSubmit = null;
        this._targetUnitId = null;
        this._stopCountdown();
        this._clearFeedback();
        this._enableButtons();
    }

    /**
     * Shows an error message with optional countdown timer
     * @param {string} message - Error message to display
     * @param {number} [retryAfterMs] - Optional: milliseconds until retry is allowed
     */
    showError(message, retryAfterMs) {
        this._stopCountdown();

        if (retryAfterMs && retryAfterMs > 0) {
            this._disableButtons();
            let remainingMs = retryAfterMs;

            const updateMessage = () => {
                const seconds = Math.ceil(remainingMs / 1000);
                this._feedbackArea.textContent = `${message} (${seconds}s)`;
            };

            updateMessage();

            this._countdownInterval = setInterval(() => {
                remainingMs -= 100;
                if (remainingMs <= 0) {
                    this._stopCountdown();
                    this._clearFeedback();
                    this._enableButtons();
                } else {
                    updateMessage();
                }
            }, 100);
        } else {
            this._feedbackArea.textContent = message;
        }
    }

    /**
     * Stops any running countdown timer
     * @private
     */
    _stopCountdown() {
        if (this._countdownInterval) {
            clearInterval(this._countdownInterval);
            this._countdownInterval = null;
        }
    }

    /**
     * Clears the feedback area
     * @private
     */
    _clearFeedback() {
        this._feedbackArea.textContent = '';
    }

    /**
     * Disables all digit buttons
     * @private
     */
    _disableButtons() {
        this._buttonsDisabled = true;
        const buttons = this._buttonsContainer.querySelectorAll('button');
        buttons.forEach(btn => {
            btn.style.background = 'rgba(50, 50, 50, 0.5)';
            btn.style.color = '#666';
            btn.style.cursor = 'not-allowed';
        });
    }

    /**
     * Enables all digit buttons
     * @private
     */
    _enableButtons() {
        this._buttonsDisabled = false;
        const buttons = this._buttonsContainer.querySelectorAll('button');
        buttons.forEach(btn => {
            btn.style.background = 'rgba(70, 70, 70, 0.8)';
            btn.style.color = '#fff';
            btn.style.cursor = 'pointer';
        });
    }

    /**
     * Check if overlay is currently visible
     * @returns {boolean}
     */
    get isVisible() {
        return this._visible;
    }

    /**
     * Get the target unit ID for the current PIN entry session
     * @returns {string|null}
     */
    get targetUnitId() {
        return this._targetUnitId;
    }

    /**
     * Destroy the overlay and clean up resources
     */
    destroy() {
        this._stopCountdown();
        if (this._overlay && this._overlay.parentNode) {
            this._overlay.parentNode.removeChild(this._overlay);
        }
        this._overlay = null;
        this._buttonsContainer = null;
        this._feedbackArea = null;
        this._onSubmit = null;
    }
}

/**
 * Factory function to initialize the SeatKeypadOverlay
 * @param {object} game - Game instance
 * @returns {SeatKeypadOverlay}
 */
export function initSeatKeypadOverlay(game) {
    return new SeatKeypadOverlay(game);
}
