/* ════════════════════════════════════════════════════════════════════
 *  NEXUS · data-loader.js  ·  v1.1.0  ·  "debug-visible"
 *  ODD NOT EVEN · Live Google Drive integration with on-page debug panel
 *  ────────────────────────────────────────────────────────────────────
 *  What's new in v1.1.0:
 *    - Floating DEBUG PANEL bottom-right (press ` or click 🐞 in topbar)
 *    - Every step logged WITH TIMESTAMP + COLOR (info/warn/error/success)
 *    - Exposes: CLIENT_ID state, token status, folder IDs, API responses,
 *      files found per folder, parsing results, last error + stack trace
 *    - "Copy all logs" button (1-click paste-back for support)
 *    - "Force resync" and "Clear cache" buttons
 *    - Health-check on boot: verifies SheetJS + GSI + CLIENT_ID + folders
 *  ────────────────────────────────────────────────────────────────────
 *  USAGE (in index.html, right before </body>):
 *    <script src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"></script>
 *    <script src="https://accounts.google.com/gsi/client" async defer></script>
 *    <script src="./data-loader.js"></script>
 *    <script>
 *      window.NEXUS_LIVE.CLIENT_ID = 'YOUR_ID.apps.googleusercontent.com';
 *      window.addEventListener('load', () => window.NEXUS_LIVE.autoConnect());
 *    </script>
 *  ═══════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  const NEXUS_LIVE = window.NEXUS_LIVE = {
    VERSION: '1.4.0',

    // ─── CONFIG ───────────────────────────────────────────
    CLIENT_ID: '',
    SCOPES: 'https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/drive.file',
    PARENT_FOLDER: '1aVLGpFyTtlDXw7SSDW1cQZTGbry7gpRm',
    FOLDERS: {
      shopify:  '1iaI7piRK88G5tgeCWRGqcpPA2CNZCawn',
      mis:      '1WUbA7SP11QPL7lgsMKemi1uo2KywV4WU',
      logistics:'1czGms22kUDvJUQQhaliaCq5DjgxH4QHR',
      invoices: '1xfsJXz9_bWE87THR3vUG3hIMUSDTigWm',
      ga4:      '1yGNZm2VNw446nZ-1XTpzWzB59UQ13JUH',
      adspends: '1fdEeM-U_3-_GZJNW_Xlz7N0fggBne1SV',
      sku:      '1vlHsw-uAVBfRrP5wTMs3ptEK_c_H2_xa'
    },
    FOLDER_PATTERNS: {
      shopify:   /shopify/i,
      mis:       /\bMIS\b/i,
      logistics: /logist/i,
      invoices:  /invoice/i,
      ga4:       /\bGA4\b|analytics/i,
      adspends:  /ad\s*spend/i,
      sku:       /\bSKU\b|inventory/i
    },
    STORAGE_KEY: 'nexus_drive_cache_v1',

    // ─── STATE ────────────────────────────────────────────
    token: null,
    tokenExpiry: 0,
    tokenClient: null,
    data: null,
    lastSync: null,
    files: {},
    connected: false,
    loading: false,
    debugLogs: [],
    lastError: null,

    // ═══════════════════════════════════════════════════════
    //  DEBUG PANEL
    // ═══════════════════════════════════════════════════════

    _logToPanel(level, msg, meta) {
      const entry = {
        t: new Date(),
        level,
        msg: String(msg),
        meta: meta !== undefined ? meta : null
      };
      this.debugLogs.push(entry);
      if (this.debugLogs.length > 500) this.debugLogs.shift();

      // Console mirror
      const tag = '%c[NEXUS]';
      const styles = {
        info:    'color:#D42B2B;font-weight:600',
        warn:    'color:#F59E0B;font-weight:600',
        error:   'color:#EF4444;font-weight:700',
        success: 'color:#10B981;font-weight:600'
      };
      const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
      if (meta !== undefined && meta !== null) fn(tag, styles[level] || styles.info, msg, meta);
      else                                     fn(tag, styles[level] || styles.info, msg);

      this._renderPanel();
    },
    log(m, meta)     { this._logToPanel('info',    m, meta); },
    warn(m, meta)    { this._logToPanel('warn',    m, meta); },
    err(m, meta)     { this._logToPanel('error',   m, meta); this.lastError = { msg: m, meta }; },
    success(m, meta) { this._logToPanel('success', m, meta); },

    _buildPanel() {
      if (document.getElementById('nx-debug-panel')) return;

      const style = document.createElement('style');
      style.id = 'nx-debug-style';
      style.textContent = `
        #nx-debug-panel{position:fixed;right:12px;bottom:12px;width:440px;max-width:calc(100vw - 24px);max-height:60vh;
          background:#0a0a0a;color:#F0EBE0;border:1px solid rgba(212,43,43,0.5);border-radius:6px;
          font-family:'DM Mono',ui-monospace,monospace;font-size:11px;line-height:1.45;z-index:99999;
          display:flex;flex-direction:column;box-shadow:0 10px 40px rgba(0,0,0,0.6);overflow:hidden;
          transition:transform .2s ease,opacity .2s ease}
        #nx-debug-panel.nx-min{transform:translateY(calc(100% - 32px))}
        #nx-debug-panel.nx-hidden{display:none}
        .nx-dp-hd{display:flex;align-items:center;justify-content:space-between;padding:7px 10px;
          background:#D42B2B;color:#fff;font-family:'Bebas Neue',sans-serif;letter-spacing:.08em;
          font-size:13px;cursor:pointer;user-select:none;flex-shrink:0;height:32px}
        .nx-dp-hd-r{display:flex;gap:6px;align-items:center}
        .nx-dp-btn{background:rgba(255,255,255,0.18);border:none;color:#fff;padding:3px 8px;
          font-size:10px;border-radius:3px;cursor:pointer;font-family:inherit;letter-spacing:.05em}
        .nx-dp-btn:hover{background:rgba(255,255,255,0.32)}
        .nx-dp-status{padding:8px 10px;background:rgba(240,235,224,0.04);border-bottom:1px solid rgba(255,255,255,0.08);
          display:grid;grid-template-columns:auto 1fr;gap:3px 10px;font-size:10px;flex-shrink:0}
        .nx-dp-status .k{color:rgba(240,235,224,0.5);text-transform:uppercase;letter-spacing:.06em}
        .nx-dp-status .v{color:#F0EBE0}
        .nx-dp-status .v.ok{color:#10B981}
        .nx-dp-status .v.warn{color:#F59E0B}
        .nx-dp-status .v.err{color:#EF4444}
        .nx-dp-logs{flex:1;overflow-y:auto;padding:6px 8px;font-size:10.5px}
        .nx-dp-logs::-webkit-scrollbar{width:6px}
        .nx-dp-logs::-webkit-scrollbar-thumb{background:rgba(212,43,43,0.4);border-radius:3px}
        .nx-dp-entry{padding:2px 0;border-bottom:1px solid rgba(255,255,255,0.04);display:flex;gap:6px;align-items:flex-start}
        .nx-dp-entry .nx-t{color:rgba(240,235,224,0.35);flex-shrink:0;font-size:9.5px;padding-top:1px}
        .nx-dp-entry .nx-l{flex:1;word-break:break-word}
        .nx-dp-entry.info .nx-l   {color:#F0EBE0}
        .nx-dp-entry.warn .nx-l   {color:#F59E0B}
        .nx-dp-entry.error .nx-l  {color:#EF4444;font-weight:600}
        .nx-dp-entry.success .nx-l{color:#10B981;font-weight:600}
        .nx-dp-entry .nx-meta{display:block;margin-top:2px;color:rgba(240,235,224,0.55);
          background:rgba(255,255,255,0.03);padding:3px 5px;border-left:2px solid rgba(212,43,43,0.5);
          font-size:9.5px;white-space:pre-wrap;word-break:break-all;border-radius:0 3px 3px 0}
        .nx-dp-ft{padding:6px 8px;background:rgba(212,43,43,0.08);border-top:1px solid rgba(212,43,43,0.25);
          display:flex;gap:5px;flex-wrap:wrap;flex-shrink:0}
        .nx-dp-ft .nx-dp-btn{background:rgba(212,43,43,0.25);color:#F0EBE0}
        .nx-dp-ft .nx-dp-btn:hover{background:rgba(212,43,43,0.45)}
        #nx-dp-launcher{position:fixed;right:12px;bottom:12px;width:44px;height:44px;border-radius:50%;
          background:#D42B2B;color:#fff;border:none;font-size:20px;cursor:pointer;z-index:99998;
          box-shadow:0 4px 20px rgba(212,43,43,0.5);display:none;align-items:center;justify-content:center}
        #nx-dp-launcher.nx-show{display:flex}
        #nx-dp-launcher .nx-badge{position:absolute;top:-3px;right:-3px;background:#F59E0B;color:#000;
          font-size:10px;font-weight:700;border-radius:10px;padding:1px 5px;font-family:'DM Mono',monospace;min-width:16px;text-align:center}
      `;
      document.head.appendChild(style);

      const launcher = document.createElement('button');
      launcher.id = 'nx-dp-launcher';
      launcher.innerHTML = '🐞<span class="nx-badge" id="nx-dp-badge">0</span>';
      launcher.title = 'NEXUS debug panel — ` to toggle';
      launcher.onclick = () => this.showPanel();
      document.body.appendChild(launcher);

      const panel = document.createElement('div');
      panel.id = 'nx-debug-panel';
      panel.innerHTML = `
        <div class="nx-dp-hd" id="nx-dp-toggle">
          <span>⚡ NEXUS DEBUG · v${this.VERSION}</span>
          <span class="nx-dp-hd-r">
            <button class="nx-dp-btn" id="nx-dp-min">_</button>
            <button class="nx-dp-btn" id="nx-dp-hide">×</button>
          </span>
        </div>
        <div class="nx-dp-status" id="nx-dp-status"></div>
        <div class="nx-dp-logs" id="nx-dp-logs"></div>
        <div class="nx-dp-ft">
          <button class="nx-dp-btn" id="nx-dp-copy">📋 Copy logs</button>
          <button class="nx-dp-btn" id="nx-dp-resync">🔄 Force resync</button>
          <button class="nx-dp-btn" id="nx-dp-auth">🔑 Re-auth</button>
          <button class="nx-dp-btn" id="nx-dp-clear">🗑 Clear cache</button>
          <button class="nx-dp-btn" id="nx-dp-test">🧪 Test Drive</button>
        </div>
      `;
      document.body.appendChild(panel);

      const self = this;
      document.getElementById('nx-dp-toggle').onclick = e => {
        if (e.target.tagName === 'BUTTON') return;
        panel.classList.toggle('nx-min');
      };
      document.getElementById('nx-dp-min').onclick = e => {
        e.stopPropagation(); panel.classList.toggle('nx-min');
      };
      document.getElementById('nx-dp-hide').onclick = e => {
        e.stopPropagation(); self.hidePanel();
      };
      document.getElementById('nx-dp-copy').onclick   = () => self.copyLogs();
      document.getElementById('nx-dp-resync').onclick = () => { self.loading = false; self.forceResync(); };
      document.getElementById('nx-dp-auth').onclick   = () => { self.loading = false; self.connect(false); };
      document.getElementById('nx-dp-clear').onclick  = () => self.clearCache();
      document.getElementById('nx-dp-test').onclick   = () => { self.loading = false; self.testAllFolders(); };

      // Keyboard toggle: backtick
      document.addEventListener('keydown', e => {
        if (e.key === '`' && !['INPUT','TEXTAREA'].includes((e.target||{}).tagName)) {
          const hidden = panel.classList.contains('nx-hidden');
          if (hidden) self.showPanel(); else self.hidePanel();
        }
      });
    },

    showPanel() {
      const p = document.getElementById('nx-debug-panel');
      const l = document.getElementById('nx-dp-launcher');
      if (p) p.classList.remove('nx-hidden','nx-min');
      if (l) l.classList.remove('nx-show');
    },
    hidePanel() {
      const p = document.getElementById('nx-debug-panel');
      const l = document.getElementById('nx-dp-launcher');
      if (p) p.classList.add('nx-hidden');
      if (l) l.classList.add('nx-show');
    },

    _renderPanel() {
      const logsEl = document.getElementById('nx-dp-logs');
      const statusEl = document.getElementById('nx-dp-status');
      const badgeEl = document.getElementById('nx-dp-badge');
      if (!logsEl || !statusEl) return;

      // STATUS rows
      const gsiReady = !!(window.google && window.google.accounts && window.google.accounts.oauth2);
      const sheetjsReady = !!window.XLSX;
      const cidOk = !!this.CLIENT_ID && this.CLIENT_ID.endsWith('.apps.googleusercontent.com');
      const tokenOk = !!this.token && Date.now() < this.tokenExpiry;
      const foldersTotal = Object.keys(this.FOLDERS).length;
      const foldersFetched = Object.keys(this.files).length;

      const rows = [
        ['Client ID', cidOk ? 'set ✓' : (this.CLIENT_ID ? 'INVALID format' : 'EMPTY'), cidOk ? 'ok' : 'err'],
        ['Google GSI lib', gsiReady ? 'loaded ✓' : 'NOT LOADED', gsiReady ? 'ok' : 'err'],
        ['SheetJS (XLSX)', sheetjsReady ? 'loaded ✓' : 'NOT LOADED', sheetjsReady ? 'ok' : 'warn'],
        ['OAuth token', tokenOk ? `valid (${Math.round((this.tokenExpiry-Date.now())/1000)}s)` : 'missing/expired', tokenOk ? 'ok' : 'warn'],
        ['Folders fetched', `${foldersFetched}/${foldersTotal}`, foldersFetched === foldersTotal ? 'ok' : 'warn'],
        ['Last sync', this.lastSync ? this.lastSync.toLocaleTimeString() : 'never', this.lastSync ? 'ok' : 'warn'],
        ['Origin', window.location.origin, 'ok']
      ];
      statusEl.innerHTML = rows.map(([k,v,cls]) =>
        `<span class="k">${k}</span><span class="v ${cls}">${v}</span>`
      ).join('');

      // LOGS
      const html = this.debugLogs.slice(-120).map(e => {
        const ts = e.t.toTimeString().slice(0,8);
        let meta = '';
        if (e.meta !== null) {
          let s;
          try { s = typeof e.meta === 'string' ? e.meta : JSON.stringify(e.meta, null, 1); }
          catch(_) { s = String(e.meta); }
          if (s.length > 800) s = s.slice(0,800) + '…';
          meta = `<span class="nx-meta">${this._esc(s)}</span>`;
        }
        return `<div class="nx-dp-entry ${e.level}"><span class="nx-t">${ts}</span><span class="nx-l">${this._esc(e.msg)}${meta}</span></div>`;
      }).join('');
      logsEl.innerHTML = html;
      logsEl.scrollTop = logsEl.scrollHeight;

      if (badgeEl) {
        const errs = this.debugLogs.filter(e => e.level === 'error').length;
        badgeEl.textContent = errs;
        badgeEl.style.background = errs > 0 ? '#EF4444' : '#10B981';
        badgeEl.style.color = '#fff';
      }
    },
    _esc(s) {
      return String(s).replace(/[&<>"']/g, c =>
        ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    },

    // ═══════════════════════════════════════════════════════
    //  ACTIONS
    // ═══════════════════════════════════════════════════════

    copyLogs() {
      const txt = this.debugLogs.map(e => {
        const ts = e.t.toISOString();
        const metaStr = e.meta !== null
          ? ' | ' + (typeof e.meta === 'string' ? e.meta : JSON.stringify(e.meta))
          : '';
        return `[${ts}] [${e.level.toUpperCase()}] ${e.msg}${metaStr}`;
      }).join('\n');
      const header = `NEXUS DEBUG LOGS
Version: ${this.VERSION}
Origin: ${window.location.origin}
UA: ${navigator.userAgent}
Client ID: ${this.CLIENT_ID ? (this.CLIENT_ID.slice(0,12)+'…') : 'EMPTY'}
Token valid: ${!!this.token && Date.now() < this.tokenExpiry}
Folders fetched: ${Object.keys(this.files).length}/${Object.keys(this.FOLDERS).length}
─────────────────────────────────────\n`;
      const full = header + txt;
      (navigator.clipboard?.writeText(full) || Promise.reject('no clipboard'))
        .then(() => this.success('Logs copied to clipboard — paste them to Claude'))
        .catch(() => {
          const ta = document.createElement('textarea');
          ta.value = full; document.body.appendChild(ta);
          ta.select(); document.execCommand('copy'); ta.remove();
          this.success('Logs copied (fallback)');
        });
    },

    clearCache() {
      try { localStorage.removeItem(this.STORAGE_KEY); this.token = null; this.tokenExpiry = 0;
        this.data = null; this.files = {}; this.lastSync = null;
        this.success('Cache cleared. Refresh to re-sync.');
      } catch(e) { this.err('Cache clear failed', String(e)); }
    },

    async forceResync() {
      this.log('▶ Force resync requested');
      try { localStorage.removeItem(this.STORAGE_KEY); } catch(_){}
      await this.connect(false);
    },

    async testAllFolders() {
      this.log('▶ Running Drive connectivity test…');
      if (!this.token || Date.now() >= this.tokenExpiry) {
        this.warn('No valid token — triggering auth first');
        const ok = await this.connect(false);
        if (!ok) return;
      }
      for (const [name, id] of Object.entries(this.FOLDERS)) {
        try {
          const files = await this.listFolder(id);
          this.success(`  ${name.padEnd(10)} → ${files.length} files`, files.map(f => f.name));
        } catch (e) {
          this.err(`  ${name.padEnd(10)} → FAILED`, String(e));
        }
      }
      this.log('▶ Connectivity test complete');
    },

    // ═══════════════════════════════════════════════════════
    //  CORE: AUTH + FETCH
    // ═══════════════════════════════════════════════════════

    async autoConnect() {
      this._buildPanel();
      this.log(`▶ Boot v${this.VERSION} · ${window.location.origin}`);
      this.log('▶ Running preflight checks…');

      if (!window.XLSX)        this.warn('SheetJS not loaded — parsing will fail. Add <script src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"></script> to <head>');
      else                     this.success('SheetJS OK');

      if (!(window.google && window.google.accounts)) {
        this.warn('Google GSI not ready yet — waiting up to 3s…');
        await this._waitFor(() => window.google && window.google.accounts && window.google.accounts.oauth2, 3000);
      }
      if (window.google && window.google.accounts) this.success('Google GSI OK');
      else                                         this.err('Google GSI library did NOT load. Add <script src="https://accounts.google.com/gsi/client" async defer></script>');

      if (!this.CLIENT_ID) {
        this.err('CLIENT_ID is EMPTY. Set window.NEXUS_LIVE.CLIENT_ID before calling autoConnect().');
        this.showPanel();
        return false;
      }
      if (!this.CLIENT_ID.endsWith('.apps.googleusercontent.com')) {
        this.err('CLIENT_ID format looks wrong', this.CLIENT_ID);
        return false;
      }
      this.success(`CLIENT_ID OK (${this.CLIENT_ID.slice(0,12)}…)`);

      // Cached data for instant render
      const cached = this.loadCache();
      if (cached) {
        this.data = cached.data;
        this.files = cached.files || {};
        this.lastSync = cached.lastSync ? new Date(cached.lastSync) : null;
        this.log(`Loaded cache from ${this.lastSync ? this.lastSync.toLocaleString() : 'unknown'}`);
        this.applyToUI();
        return await this.connect(true);
      }

      // First visit: browsers block silent OAuth popups that aren't user-initiated.
      // Require a click on 🔑 Re-auth instead of hanging this.loading forever.
      this.warn('No cached data — click 🔑 Re-auth in this panel to sign in to Google Drive');
      this.showPanel();
      return false;
    },

    _waitFor(cond, ms) {
      return new Promise(res => {
        const start = Date.now();
        const tick = () => {
          if (cond()) return res(true);
          if (Date.now() - start > ms) return res(false);
          setTimeout(tick, 100);
        };
        tick();
      });
    },

    async connect(silent) {
      if (!this.CLIENT_ID) { this.err('Cannot connect: CLIENT_ID empty'); return false; }
      if (this.loading) { this.warn('Already loading, skipping'); return false; }
      this.loading = true;
      try {
        this.log('▶ Requesting OAuth token…');
        await this._ensureTokenClient();
        const tok = await this._requestToken(silent);
        if (!tok) { this.err('Token request failed or was cancelled'); return false; }
        this.token = tok.access_token;
        this.tokenExpiry = Date.now() + (tok.expires_in * 1000) - 60000;
        this.success(`Token acquired, valid ${tok.expires_in}s`);

        await this._resolveFolders();
        await this.syncAll();
        this.connected = true;
        this.saveCache();
        this.applyToUI();
        this.success('▶ Sync complete');
        return true;
      } catch (e) {
        this.err('Connect failed', { error: String(e), stack: e && e.stack });
        return false;
      } finally { this.loading = false; this._renderPanel(); }
    },

    _ensureTokenClient() {
      return new Promise((resolve, reject) => {
        if (this.tokenClient) return resolve();
        if (!(window.google && window.google.accounts && window.google.accounts.oauth2))
          return reject(new Error('GSI not loaded'));
        try {
          this.tokenClient = google.accounts.oauth2.initTokenClient({
            client_id: this.CLIENT_ID,
            scope: this.SCOPES,
            callback: () => {}
          });
          this.log('Token client initialized');
          resolve();
        } catch (e) { reject(e); }
      });
    },

    _requestToken(silent) {
      return new Promise(resolve => {
        this.tokenClient.callback = resp => {
          if (resp.error) { this.err('OAuth error', resp); return resolve(null); }
          resolve(resp);
        };
        try {
          this.tokenClient.requestAccessToken({ prompt: silent ? '' : 'consent' });
        } catch (e) { this.err('requestAccessToken threw', String(e)); resolve(null); }
      });
    },

    // ─── DRIVE API ────────────────────────────────────────

    async _resolveFolders() {
      if (!this.PARENT_FOLDER) return;
      try {
        const q = encodeURIComponent(
          `'${this.PARENT_FOLDER}' in parents and ` +
          `mimeType = 'application/vnd.google-apps.folder' and trashed = false`
        );
        const fields = encodeURIComponent('files(id,name)');
        const url = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=${fields}&pageSize=100`;
        const r = await fetch(url, { headers: { Authorization: 'Bearer ' + this.token } });
        if (!r.ok) {
          this.warn(`Parent folder resolve failed (HTTP ${r.status}), using hardcoded IDs`);
          return;
        }
        const j = await r.json();
        const subs = j.files || [];
        this.log(`Discovered ${subs.length} subfolders under parent`, subs.map(f => f.name));
        for (const [key, pattern] of Object.entries(this.FOLDER_PATTERNS)) {
          const match = subs.find(f => pattern.test(f.name));
          if (match && this.FOLDERS[key] !== match.id) {
            this.log(`  resolve ${key} → "${match.name}"`, match.id);
            this.FOLDERS[key] = match.id;
          } else if (!match) {
            this.warn(`  resolve ${key}: no subfolder matches ${pattern}`);
          }
        }
      } catch (e) {
        this.warn('Parent folder resolve failed', String(e));
      }
    },

    async listFolder(folderId) {
      const q = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
      const fields = encodeURIComponent('files(id,name,mimeType,modifiedTime,size)');
      const url = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=${fields}&orderBy=modifiedTime desc&pageSize=100`;
      const r = await fetch(url, { headers: { Authorization: 'Bearer ' + this.token } });
      if (!r.ok) {
        const body = await r.text();
        throw new Error(`Drive list ${r.status}: ${body.slice(0,200)}`);
      }
      const j = await r.json();
      return j.files || [];
    },

    async downloadFile(fileId) {
      const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
      const r = await fetch(url, { headers: { Authorization: 'Bearer ' + this.token } });
      if (!r.ok) {
        const body = await r.text();
        throw new Error(`Drive download ${r.status}: ${body.slice(0,200)}`);
      }
      return await r.arrayBuffer();
    },

    async syncAll() {
      this.files = {};
      const names = Object.keys(this.FOLDERS);
      for (const name of names) {
        const fid = this.FOLDERS[name];
        this.log(`▶ Listing ${name}…`);
        try {
          const files = await this.listFolder(fid);
          this.files[name] = files;
          this.success(`  ${name} → ${files.length} files`, files.slice(0,5).map(f => f.name));
        } catch (e) {
          this.err(`  ${name} → FAILED`, String(e));
          this.files[name] = [];
        }
      }

      this.data = {};

      // MIS keeps its structured parser (month columns, Total sub-columns, YTD).
      const misList = this.files.mis || [];
      const latestMis = misList.find(f => /\.xlsx?$/i.test(f.name));
      if (latestMis) {
        this.log(`▶ Parsing MIS: ${latestMis.name}`);
        try {
          const buf = await this.downloadFile(latestMis.id);
          const mis = this.parseMIS(buf);
          mis._file = latestMis.name;
          this.data.mis = mis;
          this.data.jan = mis.jan; this.data.feb = mis.feb;
          this.data.mar = mis.mar; this.data.ytd = mis.ytd;
          this.success('MIS parsed', { jan: mis.jan, feb: mis.feb, mar: mis.mar, ytd: mis.ytd });
        } catch (e) { this.err('MIS parse failed', String(e)); }
      } else {
        this.warn('No .xlsx file found in MIS folder');
      }

      // Every other domain folder: pick the latest CSV / XLSX / XLS and parse it
      // with smart-header detection so GA4 (# comment rows) and Invoices
      // (title banner in row 0) produce usable column names.
      for (const name of names) {
        if (name === 'mis') continue;
        const latest = (this.files[name] || []).find(f => /\.(csv|xlsx?)$/i.test(f.name));
        if (!latest) {
          this.warn(`  ${name} → no CSV/XLSX file found`);
          this.data[name] = { rows: [], file: null };
          continue;
        }
        this.log(`▶ Parsing ${name}: ${latest.name}`);
        try {
          const buf = await this.downloadFile(latest.id);
          const parsed = this._readTable(buf);
          this.data[name] = { rows: parsed.rows, file: latest.name, sheet: parsed.sheet, headerRow: parsed.headerRow };
          this.success(
            `  ${name} parsed: ${parsed.rows.length} rows (header row ${parsed.headerRow}) from "${parsed.sheet}"`,
            parsed.rows.length ? Object.keys(parsed.rows[0]).slice(0, 6) : []
          );
        } catch (e) {
          this.err(`  ${name} parse failed`, String(e));
          this.data[name] = { rows: [], file: latest.name, error: String(e) };
        }
      }

      this.lastSync = new Date();
    },

    // ─── GENERIC TABLE READER (smart header row) ─────────
    //
    // XLSX.sheet_to_json with default settings uses row 0 as the header.
    // That breaks on files where row 0 is a banner/title (Invoices) or a
    // run of '# --- comment' lines (GA4 exports). This scans the first
    // ~12 rows and picks the one that looks most like a header: the most
    // non-empty, non-__EMPTY cells, with no leading '#'.
    _readTable(arrayBuf) {
      if (!window.XLSX) throw new Error('SheetJS not loaded');
      const wb = XLSX.read(arrayBuf, { type: 'array' });
      const sheet = wb.SheetNames[0];
      const ws = wb.Sheets[sheet];
      const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

      let headerRow = 0, best = -1;
      const maxScan = Math.min(12, raw.length);
      for (let i = 0; i < maxScan; i++) {
        const row = raw[i] || [];
        if (!row.length) continue;
        if (typeof row[0] === 'string' && /^\s*#/.test(row[0])) continue;
        const score = row.filter(c =>
          c != null && String(c).trim() !== '' && !/^__EMPTY/.test(String(c))
        ).length;
        if (score > best) { best = score; headerRow = i; }
      }

      const headerCells = raw[headerRow] || [];
      const headers = headerCells.map((h, j) => {
        const s = h == null ? '' : String(h).trim();
        return s && !/^__EMPTY/.test(s) ? s : `col${j}`;
      });
      const rows = [];
      for (let i = headerRow + 1; i < raw.length; i++) {
        const r = raw[i];
        if (!r || r.every(c => c == null || String(c).trim() === '')) continue;
        const obj = {};
        for (let j = 0; j < headers.length; j++) obj[headers[j]] = r[j];
        rows.push(obj);
      }
      return { rows, sheet, headerRow };
    },

    // ─── MIS PARSER ───────────────────────────────────────

    parseMIS(arrayBuf) {
      if (!window.XLSX) throw new Error('SheetJS not loaded');
      const wb = XLSX.read(arrayBuf, { type: 'array' });
      const sheetName = wb.SheetNames.find(n => /^MIS/i.test(n)) || wb.SheetNames[0];
      this.log(`  Using sheet "${sheetName}" from [${wb.SheetNames.join(', ')}]`);
      const ws = wb.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
      this.log(`  ${rows.length} rows in sheet`);

      // Find month columns in header row (usually row 2)
      let headerRow = -1;
      for (let i = 0; i < Math.min(5, rows.length); i++) {
        const r = rows[i] || [];
        if (r.some(c => /Jan-?26/i.test(String(c))) && r.some(c => /Feb-?26/i.test(String(c)))) {
          headerRow = i; break;
        }
      }
      if (headerRow < 0) { this.warn('  Could not find month header row, defaulting to row 1'); headerRow = 1; }
      const header = rows[headerRow] || [];
      const cols = { jan: -1, feb: -1, mar: -1, ytd: -1 };
      for (let i = 0; i < header.length; i++) {
        const v = String(header[i] || '');
        if (/Jan-?26/i.test(v) && cols.jan < 0) cols.jan = i;
        if (/Feb-?26/i.test(v) && cols.feb < 0) cols.feb = i;
        if (/Mar-?26/i.test(v) && cols.mar < 0) cols.mar = i;
        if (/YTD/i.test(v)     && cols.ytd < 0) cols.ytd = i;
      }
      this.log('  Column detection', cols);

      // For each month, find the Total sub-column (usually rightmost in the month block)
      const subRow = rows[headerRow + 1] || [];
      const findTotal = (startCol, endCol) => {
        for (let i = endCol; i >= startCol; i--) {
          if (/Total/i.test(String(subRow[i] || ''))) return i;
        }
        return -1;
      };

      const findRowByLabel = (re) => {
        for (let i = headerRow + 2; i < rows.length; i++) {
          const lab = String((rows[i] || [])[0] || '').trim();
          if (re.test(lab)) return rows[i];
        }
        return null;
      };

      const get = (row, col) => {
        if (!row || col < 0) return 0;
        const v = row[col];
        const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/,/g,'').replace(/[^\d.-]/g,''));
        return isFinite(n) ? n : 0;
      };

      const nextHeaderCol = (c) => {
        if (c < 0) return -1;
        for (let i = c + 1; i < header.length; i++) {
          if (header[i] && /26$/.test(String(header[i]))) return i;
        }
        return header.length;
      };

      const janTotal = cols.jan >= 0 ? findTotal(cols.jan, nextHeaderCol(cols.jan) - 1) : -1;
      const febTotal = cols.feb >= 0 ? findTotal(cols.feb, nextHeaderCol(cols.feb) - 1) : -1;
      const marTotal = cols.mar >= 0 ? findTotal(cols.mar, nextHeaderCol(cols.mar) - 1) : -1;
      const ytdCol = cols.ytd;

      const grab = (re) => {
        const r = findRowByLabel(re);
        return {
          jan: get(r, janTotal), feb: get(r, febTotal),
          mar: get(r, marTotal), ytd: get(r, ytdCol)
        };
      };

      const data = {
        gross:      grab(/^Gross\s*Sales/i),
        net:        grab(/^Net\s*Sales/i),
        cogs:       grab(/COGS/i),
        grossProfit:grab(/Gross\s*Profit/i),
        ebitda:     grab(/EBITDA/i),
        commission: grab(/Commission/i)
      };
      data.jan = data.gross.jan; data.feb = data.gross.feb;
      data.mar = data.gross.mar; data.ytd = data.gross.ytd;
      return data;
    },

    // ─── UI APPLY ─────────────────────────────────────────

    applyToUI() {
      try {
        // Status badge if present
        const badge = document.querySelector('.sb-drive-status') ||
                      document.querySelector('[data-drive-status]');
        if (badge) {
          const fname = (this.files.mis && this.files.mis[0] && this.files.mis[0].name) || '—';
          badge.innerHTML = `<span style="color:#10B981">●</span> LIVE · ${fname.slice(0,30)}`;
        }
        // Expose data for the dashboard's render functions to pick up
        window.NEXUS_DATA = this.data;
        window.NEXUS_FILES = this.files;
        if (typeof window.renderNexus === 'function') {
          window.renderNexus(this.data);
          this.success('Called window.renderNexus() with live data');
        } else {
          this.warn('No window.renderNexus() hook defined — dashboard JS needs to read window.NEXUS_DATA');
        }
        this.log('UI apply complete');
      } catch (e) { this.err('applyToUI failed', String(e)); }
    },

    applyAllToUI() { this.applyToUI(); },

    // ─── CACHE ────────────────────────────────────────────

    loadCache() {
      try {
        const raw = localStorage.getItem(this.STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed.lastSync) return null;
        if (Date.now() - new Date(parsed.lastSync).getTime() > 7 * 24 * 3600 * 1000) return null;
        return parsed;
      } catch(_) { return null; }
    },
    saveCache() {
      try {
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify({
          data: this.data, files: this.files, lastSync: this.lastSync
        }));
      } catch(e) { this.warn('Cache save failed', String(e)); }
    }
  };

  // Legacy aliases
  NEXUS_LIVE.setStatus = function(){};
  NEXUS_LIVE.injectStatusBadge = function(){};
  NEXUS_LIVE.showSetupBanner = function(){};
  NEXUS_LIVE.toast = function(msg){ this.log(msg); };

})();
