/**
 * NetworkDebugPanel.js - M07 Network Status Debug Overlay
 *
 * Displays CMD_BATCH flow metrics for HU-TEST evidence.
 * Shows: Role, batch counters, queue size, sequence numbers.
 *
 * Reference: docs/specs/R013_M07_GAME_LOOP.md Section 5
 */

export class NetworkDebugPanel {
  /**
   * @param {Object} game - Game instance with sessionManager
   */
  constructor(game) {
    this.game = game;
    this.container = null;
    this.updateInterval = null;
    this._visible = false;

    this._createDOM();
  }

  /**
   * Create the DOM elements for the panel
   * @private
   */
  _createDOM() {
    // Create container
    this.container = document.createElement('div');
    this.container.id = 'network-debug-panel';
    this.container.style.cssText = `
      position: fixed;
      top: 10px;
      right: 10px;
      background: rgba(0, 0, 0, 0.85);
      color: #0f0;
      font-family: 'Consolas', 'Monaco', monospace;
      font-size: 12px;
      padding: 10px 15px;
      border: 1px solid #0f0;
      border-radius: 4px;
      z-index: 10000;
      min-width: 250px;
      display: none;
      box-shadow: 0 2px 10px rgba(0, 255, 0, 0.2);
    `;

    // Title
    const title = document.createElement('div');
    title.style.cssText = `
      font-weight: bold;
      margin-bottom: 8px;
      padding-bottom: 5px;
      border-bottom: 1px solid #0a0;
      color: #0f0;
    `;
    title.textContent = '📡 Network Status (M07)';
    this.container.appendChild(title);

    // Content area
    this.contentDiv = document.createElement('div');
    this.contentDiv.style.cssText = `
      line-height: 1.6;
    `;
    this.container.appendChild(this.contentDiv);

    // Append to body
    document.body.appendChild(this.container);
  }

  /**
   * Update the displayed content
   * @private
   */
  _update() {
    if (!this._visible || !this.game.sessionManager) {
      return;
    }

    const status = this.game.sessionManager.getDebugNetStatus();
    const tick = this.game.simLoop?.tickCount || 0;
    const execEnabled = this.game.ENABLE_COMMAND_EXECUTION ? 'ON' : 'OFF';

    // Format role with color
    let roleColor = '#888';
    if (status.role === 'HOST') roleColor = '#0f0';
    else if (status.role === 'GUEST') roleColor = '#0af';

    this.contentDiv.innerHTML = `
      <div style="margin-bottom: 6px;">
        <span style="color: #888;">Role:</span>
        <span style="color: ${roleColor}; font-weight: bold;">${status.role}</span>
        <span style="color: #666; margin-left: 10px;">Exec: ${execEnabled}</span>
      </div>
      <div style="margin-bottom: 6px; border-bottom: 1px dashed #333; padding-bottom: 6px;">
        <span style="color: #888;">SimTick:</span>
        <span style="color: #ff0;">${tick}</span>
      </div>
      <div style="color: #0a0;">
        <div><span style="color: #888;">Batch Sent:</span> ${status.batchSentCount}</div>
        <div><span style="color: #888;">Batch Recv:</span> ${status.batchRecvCount}</div>
        <div><span style="color: #888;">Last batchSeq:</span> ${status.lastReceivedBatchSeq}</div>
      </div>
      <div style="margin-top: 6px; border-top: 1px dashed #333; padding-top: 6px;">
        <div><span style="color: #888;">Queue Pending:</span> <span style="color: #ff0; font-weight: bold;">${status.queuePendingCount}</span></div>
        <div><span style="color: #888;">Cmds Enqueued:</span> ${status.cmdEnqueuedCount}</div>
      </div>
      <div style="margin-top: 6px; color: #f55; font-size: 11px;">
        <div>Dropped (dup): ${status.batchDropDupCount}</div>
        <div>Dropped (stale): ${status.batchDropStaleCount}</div>
      </div>
    `;
  }

  /**
   * Show the panel and start updating
   */
  show() {
    if (this._visible) return;

    this._visible = true;
    this.container.style.display = 'block';

    // Start update loop (every 100ms)
    this.updateInterval = setInterval(() => this._update(), 100);
    this._update();

    console.log('[NetworkDebugPanel] Shown');
  }

  /**
   * Hide the panel and stop updating
   */
  hide() {
    if (!this._visible) return;

    this._visible = false;
    this.container.style.display = 'none';

    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }

    console.log('[NetworkDebugPanel] Hidden');
  }

  /**
   * Toggle panel visibility
   */
  toggle() {
    if (this._visible) {
      this.hide();
    } else {
      this.show();
    }
  }

  /**
   * Check if panel is visible
   * @returns {boolean}
   */
  isVisible() {
    return this._visible;
  }

  /**
   * Destroy the panel
   */
  destroy() {
    this.hide();
    if (this.container && this.container.parentNode) {
      this.container.parentNode.removeChild(this.container);
    }
  }
}

/**
 * Global singleton instance
 */
export let globalNetworkDebugPanel = null;

/**
 * Initialize the global network debug panel
 * @param {Object} game - Game instance
 * @returns {NetworkDebugPanel}
 */
export function initNetworkDebugPanel(game) {
  if (!globalNetworkDebugPanel) {
    globalNetworkDebugPanel = new NetworkDebugPanel(game);
  }
  return globalNetworkDebugPanel;
}
