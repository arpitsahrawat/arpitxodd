// H3 #33 · #42 — Scheduled Supabase orders mirror.
// Runs every 6 hours (per vercel.json crons). Reads the latest Supabase
// snapshot.json(.gz), unpacks it, and upserts the shopifyOnline rows into
// public.orders so the data is queryable via plain SQL for downstream
// BI tools.
//
// Currently read-only relative to Google Drive (uses whatever the client
// has synced). A true "scheduled Drive pull" requires a server-side
// service-account with drive.readonly scope — documented as a TODO so
// the user can provision one later.

export const config = { runtime: 'nodejs' };

const SUPABASE_URL = 'https://twzvinjjbwxzrmrbfpaa.supabase.co';
// Service role key should come from an env var set in Vercel project
// settings (SUPABASE_SERVICE_ROLE_KEY). Publishable key is insufficient
// for bulk upserts under stricter RLS; kept here as fallback for the
// current fully-public RLS setup.
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'sb_publishable_S2osWuKpsb4y86f4c7zkrw_rAfWGhI_';

export default async function handler(req, res) {
  try {
    // 1. Fetch the latest snapshot (prefer .gz)
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
      if (!r.ok) return res.status(404).json({ error: 'No snapshot found', status: r.status });
      payload = await r.json();
    }

    // 2. Flatten shopifyOnline rows into the orders schema
    const online = (payload.data && payload.data.shopifyOnline && payload.data.shopifyOnline.rows) || [];
    const rows = [];
    for (const r of online) {
      const idRaw = r['ST Unique Order ID'] || r['Unique order number'] || r['Shopify order number'];
      const id = idRaw ? String(idRaw).trim() + ':' + (r['Product Code'] || r['St Unique Variant Id'] || Math.random().toString(36).slice(2,6)) : null;
      if (!id) continue;
      const d = r['Order Date'] ? new Date(r['Order Date']) : null;
      rows.push({
        id,
        order_number: r['Shopify order number'] || r['Unique order number'] || null,
        order_date: d && isFinite(d.valueOf()) ? d.toISOString() : null,
        channel: r['Channel type'] || null,
        product_name: r['Product Name'] || null,
        product_code: r['Product Code'] || null,
        size: null,  // size is embedded in product name for this dataset
        quantity: Number(r['Product Quantity']) || null,
        unit_price: Number(r['Unit Selling Price']) || null,
        total_value: Number(r['Total Order value']) || Number(r['Total Product value']) || null,
        payment: r['Payment method (from Shopify)'] || null,
        status: r['Order status'] || null,
        courier: r['Courier name'] || null,
        store: null,
        _source_file: r._source || null
      });
    }

    // 3. Bulk upsert in batches of 500
    let inserted = 0;
    for (let i = 0; i < rows.length; i += 500) {
      const batch = rows.slice(i, i + 500);
      const up = await fetch(`${SUPABASE_URL}/rest/v1/orders?on_conflict=id`, {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': 'Bearer ' + SUPABASE_KEY,
          'Content-Type': 'application/json',
          'Prefer': 'resolution=merge-duplicates,return=minimal'
        },
        body: JSON.stringify(batch)
      });
      if (up.ok) inserted += batch.length;
      else console.error('upsert failed', up.status, await up.text());
    }

    return res.status(200).json({
      snapshot_synced_at: payload.lastSync,
      total_rows_in_snapshot: online.length,
      rows_mirrored: inserted
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: String(err) });
  }
}
