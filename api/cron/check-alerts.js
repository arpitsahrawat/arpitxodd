// H3 #34 · #40 — Hourly alert evaluation (server-side).
// Mirrors the browser-side evaluateAlerts() logic so alerts fire even
// when no tab is open. Pulls rules + settings + the latest snapshot
// from Supabase, compares metrics against thresholds, POSTs to the
// webhook URL (Slack/Discord) on breach, and writes alert_events.

export const config = { runtime: 'nodejs' };

const SUPABASE_URL = 'https://twzvinjjbwxzrmrbfpaa.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'sb_publishable_S2osWuKpsb4y86f4c7zkrw_rAfWGhI_';

async function sb(path, init) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_KEY,
      'Content-Type': 'application/json',
      ...(init && init.headers)
    }
  });
  return r;
}

export default async function handler(req, res) {
  try {
    // 1. Load the snapshot
    const base = `${SUPABASE_URL}/storage/v1/object/public/nexus-cache`;
    let payload;
    try {
      const r = await fetch(`${base}/snapshot.json.gz?t=${Date.now()}`);
      if (r.ok) {
        const buf = Buffer.from(await r.arrayBuffer());
        const { gunzipSync } = await import('node:zlib');
        payload = JSON.parse(gunzipSync(buf).toString('utf-8'));
      }
    } catch (_) {}
    if (!payload) {
      const r = await fetch(`${base}/snapshot.json?t=${Date.now()}`);
      if (!r.ok) return res.status(404).json({ error: 'No snapshot' });
      payload = await r.json();
    }
    const data = payload.data || {};

    // 2. Derive metrics
    const online = (data.shopifyOnline && data.shopifyOnline.rows) || [];
    const invSum = (data.invoicesSummary && data.invoicesSummary.rows) || [];
    const adMonthly = data.adspendsMonthly || {};
    const spend_2026 = Object.entries(adMonthly).filter(([k]) => k.startsWith('2026')).reduce((s, [, v]) => s + v, 0);
    const online_total = online.reduce((s, r) => s + (Number(r['Total Order value']) || 0), 0);
    const net_ytd = (data.mis && data.mis.net && data.mis.net.ytd) || 0;
    const roas = spend_2026 > 0 ? net_ytd / spend_2026 : 0;
    const parties = {};
    const partyKey = (r) => r['Party Name'] || r['party_name'] || '';
    const amtKey = (r) => Number(r['Total Amount'] || r['Amount'] || 0);
    for (const r of invSum) { const p = partyKey(r); if (p) parties[p] = (parties[p] || 0) + amtKey(r); }
    const topPartyRev = Math.max(...Object.values(parties), 0);
    const totalB2B = Object.values(parties).reduce((s, v) => s + v, 0);
    const b2b_concentration = totalB2B > 0 ? topPartyRev / totalB2B * 100 : 0;

    const metrics = {
      ytd_gross: (data.mis && data.mis.gross && data.mis.gross.ytd) || 0,
      ytd_net: net_ytd,
      ytd_ebitda: (data.mis && data.mis.ebitda && data.mis.ebitda.ytd) || 0,
      roas,
      spend_2026,
      online_orders: online.length,
      b2b_concentration
    };

    // 3. Load rules
    const rulesRes = await sb('alert_rules');
    if (!rulesRes.ok) return res.status(500).json({ error: 'rules fetch failed' });
    const rules = await rulesRes.json();
    if (!rules.length) return res.status(200).json({ rules: 0, message: 'No rules configured' });

    // 4. Load webhook
    const kvRes = await sb('settings_kv?key=eq.webhook_url');
    const kv = kvRes.ok ? await kvRes.json() : [];
    const webhook = kv[0] ? kv[0].value : '';

    // 5. Evaluate and fire
    const fired = [];
    for (const rule of rules) {
      const val = metrics[rule.metric];
      if (!isFinite(val)) continue;
      const t = Number(rule.threshold);
      const op = rule.operator;
      let breach = false;
      if (op === '<' && val < t) breach = true;
      if (op === '<=' && val <= t) breach = true;
      if (op === '>' && val > t) breach = true;
      if (op === '>=' && val >= t) breach = true;
      if (op === '==' && val === t) breach = true;
      if (!breach) continue;
      if (rule.last_fired && (Date.now() - new Date(rule.last_fired).getTime()) < 3600 * 1000) continue;
      const msg = `🚨 [NEXUS Cron] ${rule.name}: ${rule.metric}=${val.toFixed(2)} ${op} ${t}`;
      await sb('alert_events', { method: 'POST', body: JSON.stringify({ rule_id: rule.id, metric: rule.metric, value: val, threshold: t, message: msg }) });
      await sb(`alert_rules?id=eq.${rule.id}`, { method: 'PATCH', body: JSON.stringify({ last_fired: new Date().toISOString() }) });
      if (webhook) {
        try { await fetch(webhook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: msg }) }); } catch (_) {}
      }
      fired.push(msg);
    }
    return res.status(200).json({ rules: rules.length, fired: fired.length, messages: fired });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: String(err) });
  }
}
