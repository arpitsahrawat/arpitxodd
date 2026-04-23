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
    VERSION: '1.8.0',

    // ─── CANONICAL FIELD PATTERNS ───────────────────────
    // Every parsed row gets canonical aliases (_c_date, _c_amount etc.)
    // added alongside its original columns. Downstream renderers can then
    // consult a uniform field name regardless of which exporter wrote the
    // file. First matching pattern wins.
    CANONICAL_PATTERNS: {
      date:          [/^order\s*date$/i, /^date$/i, /^pickup.*date$/i, /^invoice.*date$/i, /^txn.*date$/i, /^bill.*date$/i, /^created/i],
      orderId:       [/^shopify\s*order\s*number$/i, /^unique\s*order\s*number$/i, /^st\s*unique\s*order\s*id$/i, /^order\s*id$/i, /^order\s*number$/i, /^bill\s*no/i, /^invoice\s*no/i, /^waybill.*num/i, /^awb\s*number$/i],
      party:         [/^party.?name$/i, /^customer.?name$/i, /^party$/i, /^buyer$/i, /^client$/i, /^vendor$/i],
      productName:   [/^product\s*name$/i, /^item\s*name$/i, /^style\s*name$/i, /^title$/i, /^product$/i, /^description$/i, /^item$/i],
      productCode:   [/^product\s*code$/i, /^sku$/i, /^code$/i, /^item\s*code$/i, /^style\s*code$/i, /^hsn/i],
      productType:   [/^product\s*type$/i, /^category$/i, /^section$/i, /^type$/i],
      size:          [/^size$/i, /^variant\s*size$/i],
      color:         [/^colou?r$/i],
      quantity:      [/^product\s*quantity$/i, /^quantity$/i, /^qty$/i, /^units$/i, /^pcs$/i],
      unitPrice:     [/^unit\s*selling\s*price$/i, /^unit\s*price$/i, /^selling\s*price$/i, /^price$/i, /^rate$/i, /^mrp$/i, /^unitprice$/i],
      amount:        [/^total\s*order\s*value$/i, /^total\s*product\s*value$/i, /^total\s*invoice\s*value$/i, /^net\s*amount$/i, /^gross\s*amount$/i, /^total\s*amount$/i, /^invoice\s*value$/i, /^amount$/i, /^value$/i, /^total$/i],
      discount:      [/^total\s*discount\s*value$/i, /^product\s*discount$/i, /^discount$/i],
      tax:           [/^total\s*tax/i, /^tax$/i, /^gst$/i, /^vat$/i],
      taxPercent:    [/^tax\s*percent$/i, /^tax\s*%$/i, /^gst\s*%$/i],
      commission:    [/^merchant\s*earning$/i, /^merchant\s*commission/i, /^commission$/i],
      freight:       [/^total\s*freight.*value$/i, /^estimated\s*shipping\s*amount$/i, /^actual\s*shipping\s*cost$/i, /^shipping\s*cost$/i, /^freight$/i],
      courier:       [/^courier\s*name$/i, /^courier$/i, /^carrier$/i, /^shipper$/i],
      origin:        [/^origin\s*center$/i, /^origin$/i, /^pickup\s*center$/i, /^source\s*center$/i, /^warehouse\s*name$/i],
      address:       [/^shipping\s*address$/i, /^billing\s*address$/i, /^address$/i],
      state:         [/^shipping\s*state$/i, /^billing\s*state$/i, /^state$/i],
      city:          [/^shipping\s*city$/i, /^city$/i, /^town$/i],
      pincode:       [/^pin\s*code$/i, /^pincode$/i, /^zip$/i, /^postal/i],
      paymentMethod: [/^payment\s*method.*$/i, /^payment\s*type$/i, /^mode$/i],
      paymentStatus: [/^financial\s*status$/i, /^payment.*status$/i],
      orderStatus:   [/^order\s*status$/i, /^shipment\s*status$/i, /^shipping\s*status$/i, /^status$/i],
      channel:       [/^channel\s*type$/i, /^channel$/i, /^source\s*channel$/i],
      cancelReason:  [/^cancel.*reason$/i, /^order\s*cancellation\s*reason$/i],
      ga4Source:     [/^session\s*source\s*\/\s*medium$/i, /^source\s*\/\s*medium$/i, /^source$/i],
      ga4Sessions:   [/^sessions$/i],
      ga4Engaged:    [/^engaged\s*sessions$/i],
      ga4Events:     [/^event\s*count$/i]
    },

    // ─── CONFIG ───────────────────────────────────────────
    CLIENT_ID: '',
    // Supabase Storage is used as a fast network cache. After every Drive
    // sync we serialize `{ files, data, lastSync }` as one JSON blob and
    // upload it; next page load fetches that blob (~500 ms vs 30-60 s
    // for re-downloading 20+ Drive files).
    SUPABASE_URL: 'https://twzvinjjbwxzrmrbfpaa.supabase.co',
    // Supabase Storage/REST writes reject the short-format sb_publishable_
    // key with 403 "Invalid Compact JWS" — it's a reference, not a JWT.
    // The JWT-format "anon" key (legacy) works for both reads and writes
    // under the current public RLS policies.
    SUPABASE_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR3enZpbmpqYnd4enJtcmJmcGFhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY4NTU0MzgsImV4cCI6MjA5MjQzMTQzOH0.YARSOKypyparVAPzlPPbwTzq8Fj5F7MsVOXuaVmmbUE',
    SUPABASE_BUCKET: 'nexus-cache',
    SUPABASE_SNAPSHOT: 'snapshot.json',
    SCOPES: 'https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/drive.file',
    PARENT_FOLDER: '1aVLGpFyTtlDXw7SSDW1cQZTGbry7gpRm',
    FOLDERS: {
      shopify:  '1iaI7piRK88G5tgeCWRGqcpPA2CNZCawn',
      mis:      '1WUbA7SP11QPL7lgsMKemi1uo2KywV4WU',
      logistics:'1czGms22kUDvJUQQhaliaCq5DjgxH4QHR',
      invoices: '1xfsJXz9_bWE87THR3vUG3hIMUSDTigWm',
      ga4:      '1yGNZm2VNw446nZ-1XTpzWzB59UQ13JUH',
      adspends: '1fdEeM-U_3-_GZJNW_Xlz7N0fggBne1SV',
      sku:      '1vlHsw-uAVBfRrP5wTMs3ptEZ_c_H2_xa'
    },
    COGS_STORAGE: 'nexus_cogs_overrides_v1',
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

      // Fast-path: try Supabase snapshot first. One HTTP GET instead of
      // 20 Drive downloads. If it succeeds, we paint from it immediately
      // and prime localStorage for offline subsequent loads.
      this.log('▼ Checking Supabase for cached snapshot…');
      const snap = await this.loadSnapshot();
      if (snap) {
        this.data = snap.data || {};
        this.files = snap.files || {};
        this.lastSync = snap.lastSync ? new Date(snap.lastSync) : null;
        this.success(`Loaded Supabase snapshot from ${this.lastSync ? this.lastSync.toLocaleString() : '—'} — click 🔄 Force resync to refresh from Drive`);
        try { localStorage.setItem(this.STORAGE_KEY, JSON.stringify({ data: this.data, files: this.files, lastSync: this.lastSync })); } catch(_){ }
        this.applyToUI();
        this.showPanel();
        return true;
      }

      // Cached data for instant render — paint the dashboard with whatever
      // we last synced, but DO NOT hit the network. Sync only happens on
      // an explicit 🔄 Force resync or 🔑 Re-auth click.
      const cached = this.loadCache();
      if (cached) {
        this.data = cached.data || {};
        this.files = cached.files || {};
        this.lastSync = cached.lastSync ? new Date(cached.lastSync) : null;
        // Caches from v1.5.0 lack the split shapes (shopifyOnline,
        // shopifyRetail, invoicesSummary/Items, adspendsDaily/Monthly,
        // skuMaster). Run post-processors on the cached merged data so
        // the dashboard renders immediately even on first v1.6.0 load.
        const needsUpgrade = !this.data.shopifyOnline || !this.data.invoicesSummary
          || !this.data.adspendsDaily || !this.data.skuMaster;
        if (needsUpgrade) {
          try { this._postShopifySplit(); } catch(e){ this.warn('cache upgrade: shopify split', String(e)); }
          try { this._postInvoiceSections(); } catch(e){ this.warn('cache upgrade: invoice sections', String(e)); }
          try { this._postAdspendsTranspose(); } catch(e){ this.warn('cache upgrade: adspends transpose', String(e)); }
          try { this._postSkuFlatten(); } catch(e){ this.warn('cache upgrade: sku flatten', String(e)); }
          this.log('Upgraded cached data to v1.6.0 shape (no network call)');
        }
        this.log(`Loaded cache from ${this.lastSync ? this.lastSync.toLocaleString() : 'unknown'} — click 🔄 Force resync to refresh`);
        this.applyToUI();
      } else {
        this.warn('No cached data — click 🔑 Re-auth in this panel to sign in to Google Drive');
      }
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
      if (typeof window.nxShowLoading === 'function') window.nxShowLoading('Requesting OAuth token…');
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
        this.uploadSnapshot().catch(() => {});  // fire-and-forget — don't block UI
        this.applyToUI();
        this.success('▶ Sync complete');
        return true;
      } catch (e) {
        this.err('Connect failed', { error: String(e), stack: e && e.stack });
        return false;
      } finally {
        this.loading = false;
        this._renderPanel();
        if (typeof window.nxHideLoading === 'function') window.nxHideLoading();
      }
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
      // Snapshot of previous parse so incremental sync can reuse unchanged
      // file rows keyed by (file name, modifiedTime).
      this._prevData = this.data || {};
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

      // Every other domain folder: parse EVERY CSV/XLSX/XLS (not just latest)
      // so cross-file analytics (e.g. Jan + Feb + Mar CDC reports merged) are
      // possible. Each row gets a `_source` tag identifying the file it came
      // from, and the folder exposes both per-file arrays and a merged one.
      //
      // INCREMENTAL SYNC (#6): if this folder already had parsed per-file
      // rows in `prevFiles`, any file whose modifiedTime matches an existing
      // entry is reused instead of re-downloaded. 5× faster typical resync.
      const prevFolderCache = this._prevData || {};
      let doneFolders = 0;
      const totalFolders = names.length;
      for (const name of names) {
        if (typeof window.nxUpdateLoading === 'function') {
          window.nxUpdateLoading(`Folder ${doneFolders+1}/${totalFolders} · ${name}`, (doneFolders/totalFolders)*90);
        }
        doneFolders++;
        if (name === 'mis') continue;
        const all = (this.files[name] || []).filter(f => /\.(csv|xlsx?)$/i.test(f.name));
        if (!all.length) {
          this.warn(`  ${name} → no CSV/XLSX files`);
          this.data[name] = { rows: [], files: [], file: null };
          continue;
        }
        const prevFiles = (prevFolderCache[name] && prevFolderCache[name].files) || [];
        const prevByName = new Map(prevFiles.map(f => [f.name, f]));
        const perFile = [];
        const merged = [];
        let reused = 0, fresh = 0;
        for (const f of all) {
          const hit = prevByName.get(f.name);
          if (hit && hit.modifiedTime === f.modifiedTime && Array.isArray(hit.rows)) {
            perFile.push(hit);
            for (const r of hit.rows) merged.push(Object.assign({ _source: f.name }, r));
            reused++;
            continue;
          }
          try {
            const buf = await this.downloadFile(f.id);
            const parsed = this._readTable(buf);
            // Enrich every row with canonical aliases so downstream code
            // can read `_c_date` / `_c_amount` / `_c_party` / etc. without
            // caring which exporter wrote the file.
            const canon = this._canonicalize(parsed.rows, f.name);
            perFile.push({ name: f.name, rows: canon.rows, sheet: parsed.sheet, headerRow: parsed.headerRow, modifiedTime: f.modifiedTime, mapping: canon.mapping, confidence: canon.confidence });
            for (const r of canon.rows) merged.push(Object.assign({ _source: f.name }, r));
            fresh++;
          } catch (e) {
            this.warn(`  ${name} parse failed for ${f.name}`, String(e));
          }
        }
        this.data[name] = { rows: merged, files: perFile, file: perFile[0] ? perFile[0].name : null };
        this.success(
          `  ${name} → ${merged.length} rows · ${fresh} downloaded, ${reused} reused from cache`,
          merged.length ? Object.keys(merged[0]).filter(k=>k!=='_source').slice(0, 8) : []
        );
      }

      // Post-process folders into analytics-ready shapes. Each produces a
      // sibling key on this.data without disturbing the raw folder view.
      try { this._postShopifySplit(); } catch(e){ this.warn('shopify split failed', String(e)); }
      try { this._postForwardFillOnline(); } catch(e){ this.warn('forward-fill online failed', String(e)); }
      try { await this._postInvoiceSections(); } catch(e){ this.warn('invoice sections failed', String(e)); }
      try { this._postCleanupInvoices(); } catch(e){ this.warn('invoice cleanup failed', String(e)); }
      try { this._postAdspendsTranspose(); } catch(e){ this.warn('adspends transpose failed', String(e)); }
      try { this._postSkuFlatten(); } catch(e){ this.warn('sku flatten failed', String(e)); }

      this.lastSync = new Date();
    },

    // ─── POST-PROCESSORS ─────────────────────────────────────
    //
    // Split the 16-file Shopify folder into the two logical datasets it
    // actually contains: CDC Online (Shopflo marketplace with ~75 columns)
    // vs CDC retail store reports (7 columns, one row per billed item).
    _postShopifySplit() {
      const shop = this.data.shopify;
      if (!shop || !shop.files) return;
      const online = [], retail = [];
      const onlineFiles = [], retailFiles = [];
      for (const f of shop.files) {
        const isOnline = /CDC\s*Online/i.test(f.name);
        const storeMatch = f.name.match(/CDC\s+(DELHI|MUMBAI|HYDERABAD|BANGALORE|BENGALURU)/i);
        if (isOnline) {
          onlineFiles.push(f);
          for (const r of f.rows) online.push(Object.assign({ _source: f.name }, r));
        } else if (storeMatch) {
          retailFiles.push(f);
          const store = storeMatch[1].toUpperCase();
          for (const r of f.rows) retail.push(Object.assign({ _source: f.name, _store: store }, r));
        }
      }
      this.data.shopifyOnline = { rows: online, files: onlineFiles };
      this.data.shopifyRetail = { rows: retail, files: retailFiles };
      this.log(`  split shopify: ${online.length} online rows, ${retail.length} retail rows`);
    },

    // ─── FORWARD-FILL ORDER CONTEXT (multi-item Shopflo orders) ──
    //
    // When an order has N line items, Shopflo's CSV writes order-level
    // fields (Total Order value, Payment method, shipping address, etc.)
    // on row 1 only and leaves them blank on rows 2..N. Downstream
    // renderers that aggregate per row end up thinking ~22% of rows are
    // missing data. This post-processor groups rows by order id and
    // forward-fills the order-level fields from the first non-null value.
    _postForwardFillOnline() {
      const shop = this.data.shopifyOnline;
      if (!shop || !shop.rows || !shop.rows.length) return;
      // Some rows blank out one ID column while keeping another populated,
      // so resolve each row's order key from whichever of the three
      // is non-blank. This improves group membership dramatically on
      // Shopflo's multi-line exports.
      const ID_COLS = ['ST Unique Order ID', 'Unique order number', 'Shopify order number'];
      const getId = (r) => {
        for (const c of ID_COLS) {
          const v = r[c];
          if (v != null && String(v).trim() !== '') return String(v).trim().replace(/[^\w\-]/g, '');
        }
        return '';
      };
      // Group rows by order id, preserve original order
      const orderIndex = {};
      shop.rows.forEach((r, i) => {
        const id = getId(r);
        if (!id) return;
        (orderIndex[id] = orderIndex[id] || []).push(i);
      });
      // Secondary pass: for rows with no primary id, attempt to group by
      // adjacent rows' order id (Shopflo often leaves whole ID set blank
      // on the 3rd+ line of a multi-item order). Walk the file, and if a
      // row has NO id but the previous row did, assume same order.
      let lastId = '';
      shop.rows.forEach((r, i) => {
        const id = getId(r);
        if (id) { lastId = id; return; }
        if (lastId && orderIndex[lastId]) {
          orderIndex[lastId].push(i);
          // Also back-write the ID onto this row so downstream renderers
          // treat it as part of the order.
          for (const c of ID_COLS) {
            if (r[c] == null || r[c] === '') r[c] = lastId;
          }
        }
      });
      // Fields that carry order-level context, not line-item context
      const CARRY = [
        'Order Date', 'Shopify order number', 'Unique order number',
        'Channel type', 'Total Order value', 'Total Discount value',
        'Total Tax on freight', 'Total freight value',
        'Payment method (from Shopify)', 'Payment reference (from Shopify)',
        'Payment Gateway', 'Financial Status', 'Order status',
        'Order Cancellation reason', 'Courier name', 'Service Type',
        'AWB Number', 'Shipment status', 'Shipping Address',
        'Actual shipping weight', 'Actual shipping cost',
        'Freight Reconciliation status', 'Payment Reconciliation status',
        'Payment date', 'Delivery Date', 'Invoice Date', 'Invoice number',
        '_c_date', '_c_amount', '_c_paymentMethod', '_c_paymentStatus',
        '_c_orderStatus', '_c_courier', '_c_address', '_c_freight',
        '_c_discount', '_c_cancelReason'
      ];
      let filled = 0;
      for (const idxs of Object.values(orderIndex)) {
        if (idxs.length < 2) continue;
        // Find first non-null value per field across the group
        const carriers = {};
        for (const field of CARRY) {
          for (const i of idxs) {
            const v = shop.rows[i][field];
            if (v != null && v !== '') { carriers[field] = v; break; }
          }
        }
        // Back-write onto rows that are missing
        for (const i of idxs) {
          for (const [field, val] of Object.entries(carriers)) {
            if (shop.rows[i][field] == null || shop.rows[i][field] === '') {
              shop.rows[i][field] = val;
              filled++;
            }
          }
        }
      }
      this.log(`  forward-fill shopify online: ${filled} cells filled across ${Object.keys(orderIndex).length} order groups`);
    },

    // Invoice rows without a Party Name are Total / summary / blank
    // lines that leaked past the section splitter. Drop them so the
    // data-quality panel stops flagging phantom rows.
    _postCleanupInvoices() {
      const inv = this.data.invoicesSummary;
      if (!inv || !inv.rows) return;
      const before = inv.rows.length;
      inv.rows = inv.rows.filter(r => {
        const party = r['Party Name'] || r['party_name'] || r['_c_party'];
        return party && String(party).trim() !== '' &&
               !/^total$/i.test(String(party).trim());
      });
      const dropped = before - inv.rows.length;
      if (dropped > 0) this.log(`  cleanup invoices: dropped ${dropped} summary/total rows without Party Name`);
    },

    // Invoice xlsx files have TWO tables stacked: invoice summary on top,
    // then an "Item Details" banner, then item-wise detail. Re-download
    // each invoice file and parse the raw matrix with explicit section
    // detection — much cleaner than the old column-shape heuristic.
    async _postInvoiceSections() {
      const inv = this.data.invoices;
      if (!inv || !inv.files) return;
      const summary = [], items = [];
      for (const f of inv.files) {
        try {
          // Locate the original Drive file id via this.files.invoices
          const meta = (this.files.invoices || []).find(x => x.name === f.name);
          if (!meta) continue;
          const buf = await this.downloadFile(meta.id);
          const wb  = XLSX.read(buf, { type: 'array' });
          const ws  = wb.Sheets[wb.SheetNames[0]];
          const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

          // Find section markers. Scan ALL cells in each row, not just
          // col 0 — the "Item Details …" banner often starts mid-row.
          let sumHdr = -1, itemMarker = -1, itemHdr = -1;
          for (let i = 0; i < raw.length; i++) {
            const row = raw[i] || [];
            const cells = row.map(c => String(c||'').trim());
            const hasDateCell  = cells.some(c => /^Date$/i.test(c));
            const hasParty     = cells.some(c => /party.*name/i.test(c));
            const hasTotalAmt  = cells.some(c => /total.*amount/i.test(c));
            const hasItemName  = cells.some(c => /item.*name/i.test(c));
            const hasMarker    = cells.some(c => /item\s*details|item\s*wise|item\s*wise\s*sales/i.test(c));
            if (sumHdr < 0 && hasDateCell && hasParty && hasTotalAmt) sumHdr = i;
            if (itemMarker < 0 && hasMarker) itemMarker = i;
            if (itemMarker >= 0 && i > itemMarker && itemHdr < 0 && hasDateCell && hasItemName) itemHdr = i;
          }

          const parseSection = (headerIdx, endIdx) => {
            if (headerIdx < 0) return [];
            const hdr = (raw[headerIdx] || []).map((h,j) => h != null ? String(h).trim() : `col${j}`);
            const out = [];
            for (let i = headerIdx + 1; i < endIdx; i++) {
              const r = raw[i];
              if (!r || r.every(c => c == null || String(c).trim() === '')) continue;
              const first = String(r[0]||'').trim();
              if (/^(total|item\s*details)/i.test(first)) continue;  // guard row
              const obj = { _source: f.name };
              for (let j = 0; j < hdr.length; j++) obj[hdr[j] || `col${j}`] = r[j];
              out.push(obj);
            }
            return out;
          };

          const sumEnd = itemMarker >= 0 ? itemMarker : raw.length;
          const fileSummary = parseSection(sumHdr, sumEnd);
          const fileItems   = parseSection(itemHdr, raw.length);
          summary.push(...fileSummary);
          items.push(...fileItems);
        } catch (e) {
          this.warn(`  invoice reparse failed for ${f.name}`, String(e));
        }
      }
      this.data.invoicesSummary = { rows: summary };
      this.data.invoicesItems   = { rows: items };
      this.log(`  reparse invoices: ${summary.length} summary rows, ${items.length} item rows (from raw-matrix split)`);
    },

    // Ad spend files store days 1-31 as rows and months as columns (with
    // bare month names for 2024 baseline and "Month 26" for 2026). Flatten
    // to a time series so charts can plot spend(date).
    _postAdspendsTranspose() {
      const ad = this.data.adspends;
      if (!ad || !ad.rows || !ad.rows.length) return;
      const monthIdx = (name) => ['january','february','march','april','may','june','july','august','september','october','november','december'].indexOf(name.toLowerCase());
      // Excel stores dates as day counts from 1900-01-00 (with the 1900 leap
      // year bug baked in). Serial 46048 → 2026-01-20 etc.
      const EXCEL_EPOCH = Date.UTC(1899, 11, 30);
      const serialToYM = (n) => {
        const ms = EXCEL_EPOCH + Number(n) * 86400 * 1000;
        const d = new Date(ms);
        if (!isFinite(d.valueOf())) return null;
        return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
      };
      const parseColHeader = (key) => {
        // "January 26" / "Jan 2026" / "Jan-26" / "January"
        const m = String(key).match(/^\s*([A-Za-z]{3,9})[\s\-\/'_]*(\d{2,4})?\s*$/);
        if (m && monthIdx(m[1]) >= 0) {
          const yr = m[2] ? (m[2].length === 2 ? 2000 + Number(m[2]) : Number(m[2])) : 2024;
          return { year: yr, month: monthIdx(m[1]) + 1 };
        }
        // Excel date serial — pure digits ≥ 30000 (year 1982+)
        if (/^\d{5,6}$/.test(String(key).trim())) {
          const n = Number(key);
          if (n > 30000 && n < 80000) return serialToYM(n);
        }
        // ISO-ish "2026-01-20"
        const iso = String(key).match(/^(\d{4})[-\/](\d{2})/);
        if (iso) return { year: Number(iso[1]), month: Number(iso[2]) };
        return null;
      };
      const daily = [];
      const monthly = {};
      for (const r of ad.rows) {
        // Find the day cell — often 'Date' but sometimes elsewhere; fall back
        // to the first cell holding a 1-31 integer.
        let day = Number(r.Date);
        if (!isFinite(day) || day < 1 || day > 31) {
          for (const v of Object.values(r)) {
            const n = Number(v);
            if (isFinite(n) && n >= 1 && n <= 31 && Number.isInteger(n)) { day = n; break; }
          }
        }
        if (!isFinite(day) || day < 1 || day > 31) continue;
        for (const key of Object.keys(r)) {
          if (key === 'Date' || key === '_source') continue;
          const ym = parseColHeader(key);
          if (!ym) continue;
          const v = parseFloat(String(r[key] ?? '').replace(/,/g,'').replace(/[^\d.\-]/g,''));
          if (!isFinite(v) || v <= 0) continue;
          daily.push({ day, month: ym.month, year: ym.year, spend: v,
            date: `${ym.year}-${String(ym.month).padStart(2,'0')}-${String(day).padStart(2,'0')}` });
          const mKey = `${ym.year}-${String(ym.month).padStart(2,'0')}`;
          monthly[mKey] = (monthly[mKey] || 0) + v;
        }
      }
      this.data.adspendsDaily = { rows: daily };
      this.data.adspendsMonthly = monthly;
      const years = Array.from(new Set(daily.map(d => d.year))).sort();
      this.log(`  transpose adspends: ${daily.length} day-month-year points across ${Object.keys(monthly).length} months, years [${years.join(', ')}]`);
    },

    // SKU cost sheet has multiple sheets and broken formulas. Flatten to a
    // single rows[] with normalized name, cost, selling price, and a
    // `hasCost` flag so downstream renderers can warn on gaps.
    _postSkuFlatten() {
      const sku = this.data.sku;
      if (!sku || !sku.files) return;
      // Dedupe by normalized product name across every sheet of every file.
      // If multiple rows match, prefer the one that has a valid cost.
      const byName = new Map();
      for (const f of sku.files) {
        for (const r of (f.rows || [])) {
          const name = r['Product Name'] || r['Product name'] || r['product_name'] || r['Product'] || r['Item Name'];
          const cost = this._parseMoney(r['Cost Price'] || r['COGS'] || r['Unit Cost']);
          const sell = this._parseMoney(r['Selling Price'] || r['MRP'] || r['Price']);
          if (!name) continue;
          const nameStr = String(name).trim();
          if (!nameStr || /^#(REF|NAME|DIV|VALUE)/.test(nameStr)) continue;
          const entry = {
            name: nameStr,
            normalized: this._normalizeProductName(nameStr),
            cost: isFinite(cost) ? cost : null,
            selling: isFinite(sell) ? sell : null,
            hasCost: isFinite(cost) && cost > 0,
            _source: f.name,
            _sheet: f.sheet
          };
          const key = entry.normalized;
          const existing = byName.get(key);
          if (!existing || (!existing.hasCost && entry.hasCost)) byName.set(key, entry);
        }
      }
      const flat = Array.from(byName.values()).sort((a,b) => a.name.localeCompare(b.name));
      this.data.skuMaster = { rows: flat };
      // Invalidate the resolveCost token index so it rebuilds with fresh data
      this._skuIndex = null;
      const withCost = flat.filter(r => r.hasCost).length;
      this.log(`  flatten sku: ${flat.length} unique products, ${withCost} with cost (${flat.length - withCost} missing)`);
    },

    // ─── CANONICAL FIELD ENRICHMENT ─────────────────────
    //
    // For a batch of rows from a single file, detect which source column
    // maps to each canonical field and copy the values onto `_c_<name>`
    // keys on every row. Also computes a confidence score = fraction of
    // canonical fields detected, and returns the mapping so the UI can
    // show the user exactly what was interpreted.
    _canonicalize(rows, filename) {
      if (!rows || !rows.length) return { rows: rows || [], mapping: {}, confidence: 0 };
      const cols = Object.keys(rows[0]).filter(k => k !== '_source' && k !== '_store');
      const mapping = {};
      for (const [canonical, patterns] of Object.entries(this.CANONICAL_PATTERNS)) {
        for (const p of patterns) {
          const m = cols.find(c => p.test(String(c).trim()));
          if (m) { mapping[canonical] = m; break; }
        }
      }
      const detected = Object.keys(mapping).length;
      const totalCanon = Object.keys(this.CANONICAL_PATTERNS).length;
      const confidence = Math.round((detected / totalCanon) * 100) / 100;
      // Enrich rows (non-destructive — originals preserved)
      const enriched = rows.map(r => {
        const out = Object.assign({}, r);
        for (const [canon, src] of Object.entries(mapping)) {
          const v = r[src];
          if (v != null && v !== '') out['_c_' + canon] = v;
        }
        return out;
      });
      // Stash the mapping in a registry for the UI to read
      this._schemaRegistry = this._schemaRegistry || {};
      this._schemaRegistry[filename] = { mapping, confidence, detectedFields: detected, totalColumns: cols.length, sampleCols: cols.slice(0, 10) };
      return { rows: enriched, mapping, confidence };
    },

    _parseMoney(v) {
      if (v == null || v === '') return NaN;
      if (typeof v === 'number') return v;
      const s = String(v);
      if (/^#(REF|NAME|DIV|VALUE)/.test(s)) return NaN;
      return parseFloat(s.replace(/[₹,\s]/g,'').replace(/[^\d.\-]/g,''));
    },

    // Strip Shopflo variant suffixes and normalise for matching.
    // Shopflo product names end with patterns like:
    //   " - L / White"            (size / color)
    //   " - Polyester / L"        (material / size)
    //   " - XL / BLACK"           (size / color caps)
    //   " - Cotton / M"           (material / size)
    //   " - Brown"                (color only)
    //   " - XXXL"                 (size only)
    // We want the base product stem: "97 Oversized Jersey" for matching
    // against the SKU master's "97 Oversized Jersey" row.
    _normalizeProductName(name) {
      if (!name) return '';
      let s = String(name).trim();
      // Iterate: strip trailing " - <segment>" up to 3 times (handles stacked
      // variant suffixes like "... - Polyester - L / Black")
      const VARIANT_WORDS = /^(xs|xxs|s|m|l|xl|xxl|xxxl|xxxxl|free|one\s*size|cotton|polyester|linen|denim|wool|nylon|silk|cashmere|black|white|red|blue|green|grey|gray|navy|beige|brown|olive|off\s*white|royal\s*blue)\b/i;
      for (let i = 0; i < 3; i++) {
        const m = s.match(/^(.*?)\s*-\s*([^-]+?)\s*$/);
        if (!m) break;
        const tail = m[2].trim();
        // If tail looks like a variant (has slash, is a size/colour/material word,
        // is ≤ 18 chars and has no multi-word non-variant noun), strip it.
        const hasSlash = tail.includes('/');
        const isShort = tail.length <= 18;
        const slashParts = tail.split('/').map(p => p.trim());
        const allVariant = slashParts.every(p => VARIANT_WORDS.test(p) || /^[a-zA-Z]{1,4}$/.test(p));
        if (hasSlash && allVariant) { s = m[1]; continue; }
        if (!hasSlash && isShort && VARIANT_WORDS.test(tail)) { s = m[1]; continue; }
        break;
      }
      // Strip quotes / apostrophes / unicode punctuation, normalise whitespace
      s = s.toLowerCase()
           .replace(/['"`‘’“”]/g, '')
           .replace(/[^\w\s]/g, ' ')
           .replace(/\s+/g, ' ')
           .trim();
      return s;
    },

    // Token set for fuzzy overlap scoring.
    _tokens(name) {
      const norm = this._normalizeProductName(name);
      const stop = new Set(['the','and','with','of','a','an','n','or','in','on','at','to','for']);
      return new Set(norm.split(/\s+/).filter(w => w.length >= 2 && !stop.has(w)));
    },

    // Build + cache an indexed SKU master for fast resolveCost calls.
    _buildSkuIndex() {
      const sku = (this.data.skuMaster && this.data.skuMaster.rows) || [];
      this._skuIndex = sku.map(r => Object.assign({}, r, {
        normalized: this._normalizeProductName(r.name),
        tokens: this._tokens(r.name)
      }));
    },

    // ─── COGS MASTER (localStorage-backed per-product cost overrides) ───

    loadCogsOverrides() {
      try { return JSON.parse(localStorage.getItem(this.COGS_STORAGE) || '{}'); }
      catch(_) { return {}; }
    },
    saveCogsOverride(productName, cost) {
      const all = this.loadCogsOverrides();
      const key = this._normalizeProductName(productName);
      if (!key) return;
      const oldValue = all[key];
      let action = 'cogs_set';
      if (cost === null || cost === undefined || cost === '' || !isFinite(Number(cost))) {
        delete all[key];
        action = 'cogs_clear';
      } else {
        all[key] = Number(cost);
      }
      try { localStorage.setItem(this.COGS_STORAGE, JSON.stringify(all)); } catch(_){ }
      this.logAudit(action, { product: productName, normalized: key, old: oldValue, new: all[key] || null });
    },
    // Resolve cost for a given product name.
    // Waterfall: user override → exact normalised → all-tokens subset →
    // weighted token overlap ≥ 0.5. Returns cost + source + confidence +
    // matched-name for debugging in the COGS Master UI.
    resolveCost(productName) {
      if (!productName) return { cost: null, source: 'missing', confidence: 0 };
      const key = this._normalizeProductName(productName);
      // 1. User override (highest precedence, perfect confidence)
      const overrides = this.loadCogsOverrides();
      if (key in overrides) return { cost: overrides[key], source: 'override', confidence: 1, matched: productName };
      // Build (lazy) + cache the SKU index
      if (!this._skuIndex) this._buildSkuIndex();
      const index = this._skuIndex || [];
      // 2. Exact normalised match
      let exact = index.find(r => r.hasCost && r.normalized === key);
      if (exact) return { cost: exact.cost, source: 'exact', confidence: 1, matched: exact.name };
      // 3. Token-subset: every SKU token appears in query (or vice versa)
      const qTokens = this._tokens(productName);
      if (qTokens.size === 0) return { cost: null, source: 'missing', confidence: 0 };
      let subsetHit = null, subsetScore = 0;
      for (const r of index) {
        if (!r.hasCost || r.tokens.size === 0) continue;
        const skuInQ = Array.from(r.tokens).every(t => qTokens.has(t));
        const qInSku = Array.from(qTokens).every(t => r.tokens.has(t));
        if (skuInQ || qInSku) {
          // Score = shared-token count / max set size
          let shared = 0;
          for (const t of r.tokens) if (qTokens.has(t)) shared++;
          const score = shared / Math.max(r.tokens.size, qTokens.size);
          if (score > subsetScore) { subsetScore = score; subsetHit = r; }
        }
      }
      if (subsetHit && subsetScore >= 0.5) {
        return { cost: subsetHit.cost, source: 'token-subset', confidence: subsetScore, matched: subsetHit.name };
      }
      // 4. Weighted Jaccard overlap ≥ 0.5
      let fuzzy = null, fuzzyScore = 0;
      for (const r of index) {
        if (!r.hasCost || r.tokens.size === 0) continue;
        let shared = 0;
        for (const t of r.tokens) if (qTokens.has(t)) shared++;
        const union = new Set([...r.tokens, ...qTokens]).size;
        const score = union > 0 ? shared / union : 0;
        if (score > fuzzyScore) { fuzzyScore = score; fuzzy = r; }
      }
      if (fuzzy && fuzzyScore >= 0.5) {
        return { cost: fuzzy.cost, source: 'fuzzy', confidence: fuzzyScore, matched: fuzzy.name };
      }
      return { cost: null, source: 'missing', confidence: 0 };
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
        commission: grab(/Commission/i),
        discount:   grab(/^(Less:\s*)?(Website\s*)?Discount/i),
        gst:        grab(/^(Less:\s*)?GST/i),
        fdIncome:   grab(/FD\s*Interest|Interest\s*Income/i),
        otherExp:   grab(/Other\s*Expenses/i),
        directorSalary: grab(/Director.*Salary/i),
        salary:     grab(/^Salary\s*Expense|^Salaries/i),
        kaCharges:  grab(/KA\s*Professional|Karan\s*Aujla/i),
        photoshoot: grab(/Photoshoot/i),
        ads:        grab(/^Advertisement|^Ads?\b/i),
        rent:       grab(/Office\s*Rent|^Rent\b/i),
        gateway:    grab(/Payment\s*Gateway/i),
        logistics:  grab(/^Logistics|^Shipping\s*Expense/i),
        travel:     grab(/^Travel/i),
        professional: grab(/Professional\s*Fees/i),
        utilities:  grab(/^Utilities|^Internet\b|^Electricity/i)
      };
      // Filter zero-everywhere lines so Financials → Operating Expenses only
      // shows lines that actually exist in this period.
      for (const k of Object.keys(data)) {
        const r = data[k];
        if (!r) { delete data[k]; continue; }
        const allZero = !isFinite(r.jan) && !isFinite(r.feb) && !isFinite(r.mar) && !isFinite(r.ytd);
        const sumZero = (r.jan||0) === 0 && (r.feb||0) === 0 && (r.mar||0) === 0 && (r.ytd||0) === 0;
        if (allZero || sumZero) delete data[k];
      }
      // Ensure the big 6 always exist (even if zero) so downstream renderers
      // that expect them don't break.
      for (const k of ['gross','net','cogs','grossProfit','ebitda','commission']) {
        if (!data[k]) data[k] = { jan:0, feb:0, mar:0, ytd:0 };
      }
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

    // ─── SUPABASE FAST-PATH CACHE ─────────────────────────
    //
    // Downloads the latest `snapshot.json` from the public nexus-cache
    // bucket. One HTTP GET, no OAuth, no XLSX parsing. Returns the same
    // shape as loadCache() or null on miss.
    async loadSnapshot() {
      if (!this.SUPABASE_URL || !this.SUPABASE_BUCKET) return null;
      const t = Date.now();
      const base = `${this.SUPABASE_URL}/storage/v1/object/public/${this.SUPABASE_BUCKET}`;
      // Prefer gzipped snapshot (smaller → faster transfer)
      try {
        const rGz = await fetch(`${base}/${this.SUPABASE_SNAPSHOT}.gz?t=${t}`);
        if (rGz.ok) {
          const blob = await rGz.blob();
          const text = await this._gunzip(blob);
          if (text) {
            const parsed = JSON.parse(text);
            if (parsed.lastSync) return parsed;
          }
        }
      } catch (_) {}
      // Fall back to uncompressed
      try {
        const r = await fetch(`${base}/${this.SUPABASE_SNAPSHOT}?t=${t}`);
        if (!r.ok) { this.log(`Supabase snapshot ${r.status} — skipping fast path`); return null; }
        const blob = await r.json();
        if (!blob.lastSync) return null;
        return blob;
      } catch (e) {
        this.warn('Supabase snapshot fetch failed', String(e));
        return null;
      }
    },

    // Helper: gzip a string using native CompressionStream. Returns a Blob.
    async _gzip(str) {
      if (typeof CompressionStream === 'undefined') return null;
      const stream = new Response(new Blob([str])).body.pipeThrough(new CompressionStream('gzip'));
      const buf = await new Response(stream).arrayBuffer();
      return new Blob([buf], { type: 'application/octet-stream' });
    },
    async _gunzip(blob) {
      if (typeof DecompressionStream === 'undefined') return null;
      const stream = blob.stream().pipeThrough(new DecompressionStream('gzip'));
      return await new Response(stream).text();
    },

    // ─── SUPABASE · SQL helpers ───────────────────────────
    //
    // These wrap the Supabase REST endpoint for the three tables
    // created in migration `annotations_audit_versions`. They're all
    // best-effort — any error is logged but never throws.

    async sbInsert(table, row) {
      if (!this.SUPABASE_URL || !this.SUPABASE_KEY) return null;
      try {
        const r = await fetch(`${this.SUPABASE_URL}/rest/v1/${table}`, {
          method: 'POST',
          headers: {
            'apikey': this.SUPABASE_KEY,
            'Authorization': 'Bearer ' + this.SUPABASE_KEY,
            'Content-Type': 'application/json',
            'Prefer': 'return=representation'
          },
          body: JSON.stringify(row)
        });
        if (!r.ok) { this.warn(`sb ${table} insert ${r.status}: ${(await r.text()).slice(0,120)}`); return null; }
        const arr = await r.json();
        return arr && arr[0];
      } catch(e) { this.warn(`sb ${table} insert failed`, String(e)); return null; }
    },
    async sbSelect(table, params) {
      if (!this.SUPABASE_URL || !this.SUPABASE_KEY) return [];
      try {
        const qs = Object.entries(params || {}).map(([k,v])=>`${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
        const r = await fetch(`${this.SUPABASE_URL}/rest/v1/${table}?${qs}`, {
          headers: {
            'apikey': this.SUPABASE_KEY,
            'Authorization': 'Bearer ' + this.SUPABASE_KEY
          }
        });
        if (!r.ok) return [];
        return await r.json();
      } catch(_) { return []; }
    },
    async sbDelete(table, params) {
      if (!this.SUPABASE_URL || !this.SUPABASE_KEY) return false;
      try {
        const qs = Object.entries(params || {}).map(([k,v])=>`${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
        const r = await fetch(`${this.SUPABASE_URL}/rest/v1/${table}?${qs}`, {
          method: 'DELETE',
          headers: {
            'apikey': this.SUPABASE_KEY,
            'Authorization': 'Bearer ' + this.SUPABASE_KEY
          }
        });
        return r.ok;
      } catch(_) { return false; }
    },
    logAudit(action, payload) {
      this.sbInsert('audit_log', { actor: this.CLIENT_ID ? this.CLIENT_ID.slice(0,12) : 'anon', action, payload }).catch(()=>{});
    },

    async uploadSnapshot() {
      if (!this.SUPABASE_URL || !this.SUPABASE_KEY || !this.SUPABASE_BUCKET) return false;
      try {
        const payload = {
          version: this.VERSION,
          lastSync: this.lastSync,
          files: this.files,
          data: this.data
        };
        const body = JSON.stringify(payload);
        // Try gzip first (item #7); fall back to raw JSON if CompressionStream
        // unavailable or browser-side gzip fails. Store .gz for the compressed
        // path and .json for raw so the fetcher can pick the smaller one.
        const gz = await this._gzip(body).catch(() => null);
        const useGz = gz && gz.size < body.length;
        const path = useGz ? this.SUPABASE_SNAPSHOT + '.gz' : this.SUPABASE_SNAPSHOT;
        const url = `${this.SUPABASE_URL}/storage/v1/object/${this.SUPABASE_BUCKET}/${path}`;
        const r = await fetch(url, {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer ' + this.SUPABASE_KEY,
            'Content-Type': useGz ? 'application/octet-stream' : 'application/json',
            'x-upsert': 'true',
            'cache-control': 'max-age=0'
          },
          body: useGz ? gz : body
        });
        if (!r.ok) {
          const t = await r.text();
          this.warn(`Supabase snapshot upload ${r.status}: ${t.slice(0,160)}`);
          return false;
        }
        const uploadedKB = (useGz ? gz.size : body.length) / 1024;
        const rawKB = body.length / 1024;
        this.success(`▲ Snapshot uploaded ${useGz?'(gzipped)':''} ${uploadedKB.toFixed(1)} KB${useGz?` (from ${rawKB.toFixed(1)} KB, ${(100*(1-uploadedKB/rawKB)).toFixed(0)}% smaller)`:''}`);
        // H3 #41: write a snapshot_versions row so the dashboard can scrub
        // back to historical state later. The blob itself always lives at
        // the same storage key; we keep metadata here.
        this.sbInsert('snapshot_versions', {
          version_tag: this.VERSION + '+' + new Date().toISOString(),
          storage_key: path,
          byte_size: Math.round((useGz ? gz.size : body.length)),
          note: `sync-of-${Object.keys(this.files||{}).length}-folders`
        }).catch(()=>{});
        this.logAudit('snapshot_upload', { size: Math.round((useGz?gz.size:body.length)), gzipped: !!useGz });
        return true;
      } catch (e) {
        this.warn('Supabase snapshot upload failed', String(e));
        return false;
      }
    },
    saveCache() {
      // With the data split shapes (online/retail/summary/items/daily/master)
      // plus per-file raw rows, the full payload routinely exceeds the
      // ~5 MB localStorage cap and throws QuotaExceededError. Supabase
      // already has the authoritative snapshot; localStorage only needs
      // to remember "when we last synced" for the freshness pill to show
      // instantly on boot.
      const meta = { lastSync: this.lastSync, version: this.VERSION };
      try {
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify({
          data: this.data, files: this.files, lastSync: this.lastSync
        }));
      } catch(e) {
        // Fall back to meta-only on quota errors so the pill + boot
        // still work; full data comes from Supabase snapshot instead.
        try {
          localStorage.setItem(this.STORAGE_KEY, JSON.stringify(meta));
          this.warn('Cache too big for localStorage; stored metadata only — full data lives on Supabase');
        } catch(_) { this.warn('Cache save failed entirely', String(e)); }
      }
    }
  };

  // Legacy aliases
  NEXUS_LIVE.setStatus = function(){};
  NEXUS_LIVE.injectStatusBadge = function(){};
  NEXUS_LIVE.showSetupBanner = function(){};
  NEXUS_LIVE.toast = function(msg){ this.log(msg); };

})();
