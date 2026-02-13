/**
 * NetworkDebugPanel.js - Unified Network & Session Debug Overlay
 *
 * Merged panel combining:
 * - R012 Dev HUD (NET MODE, AUTH, REALTIME, DB status, Save/Load)
 * - M07 Network Status (Role, SimTick, batch counters, queue, drops)
 *
 * Reference: docs/specs/R013_M07_GAME_LOOP.md Section 5
 */

import { makeDraggable } from './makeDraggable.js';

export class NetworkDebugPanel {
  /**
   * @param {Object} game - Game instance with sessionManager
   */
  constructor(game) {
    this.game = game;
    this.container = null;
    this.updateInterval = null;
    this._visible = false;

    // R012 status fields (set externally via setNetStatus / setDBStatus)
    this._netMode = '---';
    this._netModeColor = '#888';
    this._configText = '---';
    this._configColor = '#888';
    this._authText = '---';
    this._authColor = '#888';
    this._rtText = '---';
    this._rtColor = '#888';
    this._dbText = 'ready';
    this._dbColor = '#888';

    this._createDOM();
  }

  /**
   * Create the DOM elements for the unified panel
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
      z-index: 15000;
      min-width: 280px;
      display: none;
      box-shadow: 0 2px 10px rgba(0, 255, 0, 0.2);
      user-select: none;
    `;

    // Title (drag handle)
    const title = document.createElement('div');
    title.style.cssText = `
      font-weight: bold;
      margin-bottom: 8px;
      padding-bottom: 5px;
      border-bottom: 1px solid #0a0;
      color: #0f0;
      display: flex;
      justify-content: space-between;
      align-items: center;
    `;
    title.innerHTML = '<span>\u{1F4E1} Network & Session</span><span style="color:#0a0;font-size:9px;">drag</span>';
    this.container.appendChild(title);

    // Make draggable via title bar
    makeDraggable(this.container, title);

    // Content area (updated by _update)
    this.contentDiv = document.createElement('div');
    this.contentDiv.style.cssText = `
      line-height: 1.6;
    `;
    this.container.appendChild(this.contentDiv);

    // Separator before Save/Load
    this.buttonSeparator = document.createElement('div');
    this.buttonSeparator.style.cssText = `
      border-top: 1px dashed #333;
      padding-top: 8px;
      margin-top: 8px;
      display: flex;
      gap: 8px;
    `;

    // Save button
    this.btnSave = document.createElement('button');
    this.btnSave.id = 'r012-btn-save';
    this.btnSave.textContent = 'Save';
    this.btnSave.style.cssText = `
      background: #1a1;
      color: #fff;
      border: none;
      padding: 4px 12px;
      border-radius: 3px;
      cursor: pointer;
      font-family: 'Consolas', 'Monaco', monospace;
      font-size: 11px;
    `;
    this.buttonSeparator.appendChild(this.btnSave);

    // Load button
    this.btnLoad = document.createElement('button');
    this.btnLoad.id = 'r012-btn-load';
    this.btnLoad.textContent = 'Load';
    this.btnLoad.style.cssText = `
      background: #17a;
      color: #fff;
      border: none;
      padding: 4px 12px;
      border-radius: 3px;
      cursor: pointer;
      font-family: 'Consolas', 'Monaco', monospace;
      font-size: 11px;
    `;
    this.buttonSeparator.appendChild(this.btnLoad);

    this.container.appendChild(this.buttonSeparator);

    // DB status line
    this.dbStatusDiv = document.createElement('div');
    this.dbStatusDiv.style.cssText = `
      color: #888;
      font-size: 10px;
      margin-top: 6px;
    `;
    this.dbStatusDiv.textContent = 'DB: ready';
    this.container.appendChild(this.dbStatusDiv);

    // Append to body
    document.body.appendChild(this.container);
  }

  /**
   * R012: Set network mode status (called from Game._updateNetStatus)
   * @param {string} mode - 'SUPABASE' or 'LOCAL'
   * @param {Object} info - { config, auth, rt }
   */
  setNetStatus(mode, info = {}) {
    const isSupabase = mode === 'SUPABASE';
    this._netMode = isSupabase ? 'SUPABASE' : 'LOCAL';
    this._netModeColor = isSupabase ? '#4caf50' : '#888';

    if (info.config) {
      this._configText = info.config;
      this._configColor = info.config === 'OK' ? '#4caf50' : '#f44336';
    }

    if (info.auth) {
      this._authText = info.auth;
      this._authColor = info.auth === 'ANON OK' ? '#4caf50' : '#f44336';
    }

    if (info.rt) {
      this._rtText = info.rt;
      if (info.rt === 'CONNECTED') {
        this._rtColor = '#4caf50';
      } else if (info.rt === 'CONNECTING...') {
        this._rtColor = '#ff9800';
      } else {
        this._rtColor = '#f44336';
      }
    }

    // Update immediately if visible
    if (this._visible) this._update();
  }

  /**
   * R012: Set realtime connection status (called from polling)
   * @param {string} rtText
   * @param {string} rtColor
   */
  setRealtimeStatus(rtText, rtColor) {
    this._rtText = rtText;
    this._rtColor = rtColor;
  }

  /**
   * R012: Update DB status line
   * @param {string} msg
   * @param {boolean} isError
   */
  setDBStatus(msg, isError = false) {
    this._dbText = msg;
    this._dbColor = isError ? '#f44336' : '#4caf50';
    if (this.dbStatusDiv) {
      this.dbStatusDiv.textContent = `DB: ${msg}`;
      this.dbStatusDiv.style.color = this._dbColor;
    }
  }

  /**
   * Update the displayed content
   * @private
   */
  _update() {
    if (!this._visible) {
      return;
    }

    // M07 network stats (if sessionManager exists)
    let role = 'OFFLINE';
    let status = null;
    if (this.game.sessionManager) {
      status = this.game.sessionManager.getDebugNetStatus();
      role = status.role;
    }
    const tick = this.game.simLoop?.tickCount || 0;
    const execEnabled = this.game.ENABLE_COMMAND_EXECUTION ? 'ON' : 'OFF';

    // Format role with color
    let roleColor = '#888';
    if (role === 'HOST') roleColor = '#0f0';
    else if (role === 'GUEST') roleColor = '#0af';

    // Build unified content
    let html = '';

    // Row 1: Role + Exec
    html += `<div style="margin-bottom: 4px;">
      <span style="color: #888;">Role:</span>
      <span style="color: ${roleColor}; font-weight: bold;">${role}</span>
      <span style="color: #666; margin-left: 20px;">Exec:</span>
      <span style="color: ${execEnabled === 'ON' ? '#0f0' : '#f55'}; font-weight: bold;">${execEnabled}</span>
    </div>`;

    // Row 2: SimTick
    html += `<div style="margin-bottom: 6px; border-bottom: 1px dashed #333; padding-bottom: 6px;">
      <span style="color: #888;">SimTick:</span>
      <span style="color: #ff0;">${tick}</span>
    </div>`;

    // Row 3: NET + AUTH
    html += `<div style="margin-bottom: 2px;">
      <span style="color: #888;">NET:</span>
      <span style="color: ${this._netModeColor}; font-weight: bold;">${this._netMode}</span>
      <span style="color: #888; margin-left: 20px;">AUTH:</span>
      <span style="color: ${this._authColor};">${this._authText}</span>
    </div>`;

    // Row 4: RT + DB
    html += `<div style="margin-bottom: 6px; border-bottom: 1px dashed #333; padding-bottom: 6px;">
      <span style="color: #888;">RT:</span>
      <span style="color: ${this._rtColor};">${this._rtText}</span>
      <span style="color: #888; margin-left: 20px;">DB:</span>
      <span style="color: ${this._dbColor};">${this._dbText}</span>
    </div>`;

    // Batch stats (only if sessionManager provides data)
    if (status) {
      html += `<div style="color: #0a0;">
        <div>
          <span style="color: #888;">Batch Sent:</span> ${status.batchSentCount}
          <span style="color: #888; margin-left: 16px;">Batch Recv:</span> ${status.batchRecvCount}
        </div>
        <div>
          <span style="color: #888;">Last batchSeq:</span> ${status.lastReceivedBatchSeq}
          <span style="color: #888; margin-left: 16px;">Queue:</span>
          <span style="color: #ff0; font-weight: bold;">${status.queuePendingCount}</span>
        </div>
      </div>`;

      html += `<div style="margin-top: 4px; border-top: 1px dashed #333; padding-top: 4px;">
        <div><span style="color: #888;">Cmds Enqueued:</span> ${status.cmdEnqueuedCount}</div>
      </div>`;

      html += `<div style="margin-top: 4px; color: #f55; font-size: 11px;">
        <div>Dropped (dup): ${status.batchDropDupCount}</div>
        <div>Dropped (stale): ${status.batchDropStaleCount}</div>
      </div>`;
    }

    this.contentDiv.innerHTML = html;
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
