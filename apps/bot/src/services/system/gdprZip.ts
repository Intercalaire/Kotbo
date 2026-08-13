import { zipSync, strToU8 } from 'fflate';
import type { GdprExport } from './gdprExportService.js';

/** Sérialise en gérant les BigInt (convertis en chaîne) et les Date. */
function stringify(value: unknown): string {
  return JSON.stringify(
    value,
    (_key, val) => (typeof val === 'bigint' ? val.toString() : val),
    2,
  );
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Génère la page HTML de navigation autonome (données embarquées). */
function buildIndexHtml(data: GdprExport): string {
  // Les données sont embarquées telles quelles pour une consultation hors-ligne.
  const payload = stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e');
  const title = `Export RGPD - ${data.meta.username ?? data.meta.userId}`;

  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>
  :root {
    --bg: #0f1115; --surface: #171a21; --surface2: #1e222b; --border: #2a2f3a;
    --text: #e6e8ec; --muted: #9aa2b1; --primary: #6c8cff; --accent: #3ad29f;
  }
  @media (prefers-color-scheme: light) {
    :root { --bg:#f5f6f8; --surface:#fff; --surface2:#eef0f4; --border:#dcdfe6; --text:#1a1d24; --muted:#5b6472; --primary:#3a5bff; --accent:#0a9f77; }
  }
  * { box-sizing: border-box; }
  body { margin:0; font-family: -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif; background:var(--bg); color:var(--text); }
  header { padding:20px 24px; border-bottom:1px solid var(--border); background:var(--surface); }
  header h1 { margin:0 0 6px; font-size:18px; }
  header .meta { color:var(--muted); font-size:13px; display:flex; flex-wrap:wrap; gap:14px; }
  header .meta b { color:var(--text); font-weight:600; }
  .layout { display:flex; min-height:calc(100vh - 74px); }
  aside { width:280px; flex-shrink:0; border-right:1px solid var(--border); background:var(--surface); overflow-y:auto; }
  aside .cat { padding:4px; }
  aside button { width:100%; text-align:left; background:none; border:none; color:var(--text); padding:10px 16px; cursor:pointer; font-size:14px; border-radius:8px; display:flex; justify-content:space-between; gap:8px; align-items:center; }
  aside button:hover { background:var(--surface2); }
  aside button.active { background:var(--primary); color:#fff; }
  aside .catlabel { font-weight:600; }
  aside .badge { background:var(--surface2); color:var(--muted); font-size:11px; padding:2px 8px; border-radius:999px; }
  aside button.active .badge { background:rgba(255,255,255,.25); color:#fff; }
  aside .desc { color:var(--muted); font-size:11px; padding:0 16px 10px; }
  main { flex:1; padding:24px; overflow-x:auto; min-width:0; }
  main h2 { margin:0 0 4px; font-size:20px; }
  main .catdesc { color:var(--muted); margin:0 0 20px; font-size:13px; }
  .table-block { margin-bottom:28px; }
  .table-block h3 { font-size:15px; margin:0 0 10px; display:flex; gap:10px; align-items:center; }
  .table-block h3 .badge { background:var(--surface2); color:var(--muted); font-size:11px; padding:2px 8px; border-radius:999px; font-weight:500; }
  .record { background:var(--surface); border:1px solid var(--border); border-radius:10px; margin-bottom:10px; overflow:hidden; }
  .record summary { cursor:pointer; padding:10px 14px; font-size:13px; color:var(--muted); user-select:none; }
  .record summary:hover { background:var(--surface2); }
  .record pre { margin:0; padding:14px; background:var(--surface2); overflow-x:auto; font-size:12.5px; line-height:1.5; border-top:1px solid var(--border); }
  .empty { color:var(--muted); font-style:italic; }
  .search { width:100%; padding:9px 12px; margin:8px 0 12px; background:var(--surface2); border:1px solid var(--border); border-radius:8px; color:var(--text); font-size:13px; }
  code.k { color:var(--accent); }
</style>
</head>
<body>
<header>
  <h1>Export RGPD - <b>${escapeHtml(data.meta.username ?? data.meta.userId)}</b></h1>
  <div class="meta">
    <span>ID Discord&nbsp;: <b>${escapeHtml(data.meta.userId)}</b></span>
    <span>Enregistrements&nbsp;: <b>${data.meta.totalRecords}</b></span>
    <span>Serveurs&nbsp;: <b>${data.meta.guildCount}</b></span>
    <span>Généré le&nbsp;: <b>${escapeHtml(new Date(data.meta.generatedAt).toLocaleString('fr-FR'))}</b></span>
  </div>
</header>
<div class="layout">
  <aside id="nav"></aside>
  <main id="content"></main>
</div>
<script id="gdpr-data" type="application/json">${payload}</script>
<script>
  const DATA = JSON.parse(document.getElementById('gdpr-data').textContent);
  const nav = document.getElementById('nav');
  const content = document.getElementById('content');
  let active = 0;

  const sections = [
    { key:'__identity', label:'Identité', description:"Identité Discord et serveurs concernés.", count: DATA.identity.guilds.length },
    ...DATA.categories.map(c => ({ key:c.key, label:c.label, description:c.description, count:c.count }))
  ];

  function renderNav() {
    nav.innerHTML = sections.map((s,i) =>
      '<div class="cat">'
      + '<button data-i="'+i+'" class="'+(i===active?'active':'')+'">'
      + '<span class="catlabel">'+s.label+'</span>'
      + '<span class="badge">'+s.count+'</span>'
      + '</button>'
      + '</div>'
    ).join('');
    nav.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
      active = +b.dataset.i; renderNav(); renderContent();
    }));
  }

  function jsonBlock(obj) {
    return '<pre>'+ escapeHtml(JSON.stringify(obj, null, 2)) +'</pre>';
  }
  function escapeHtml(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  function recordTitle(rec) {
    const parts = [];
    for (const k of ['createdAt','date','activityDate','timestamp','guildId','status','type']) {
      if (rec && rec[k] != null) parts.push(k+': '+String(rec[k]).slice(0,40));
      if (parts.length >= 2) break;
    }
    return parts.length ? parts.join('  ·  ') : 'Enregistrement';
  }

  function renderContent() {
    const s = sections[active];
    if (s.key === '__identity') {
      content.innerHTML = '<h2>Identité</h2><p class="catdesc">'+s.description+'</p>'
        + '<div class="table-block"><h3>Utilisateur Discord</h3>'
        + (DATA.identity.discordUser ? jsonBlock(DATA.identity.discordUser) : '<p class="empty">Utilisateur Discord introuvable (fetch échoué).</p>')
        + '</div>'
        + '<div class="table-block"><h3>Serveurs concernés <span class="badge">'+DATA.identity.guilds.length+'</span></h3>'
        + (DATA.identity.guilds.length ? jsonBlock(DATA.identity.guilds) : '<p class="empty">Aucun</p>')
        + '</div>';
      return;
    }
    const cat = DATA.categories.find(c => c.key === s.key);
    let html = '<h2>'+cat.label+'</h2><p class="catdesc">'+cat.description+'</p>';
    html += '<input class="search" placeholder="Filtrer dans cette catégorie..." oninput="filterRecords(this.value)" />';
    for (const t of cat.tables) {
      html += '<div class="table-block"><h3>'+t.label+' <span class="badge">'+t.count+'</span></h3>';
      html += t.records.map(r =>
        '<details class="record"><summary>'+escapeHtml(recordTitle(r))+'</summary>'+jsonBlock(r)+'</details>'
      ).join('');
      html += '</div>';
    }
    content.innerHTML = html;
  }

  window.filterRecords = function(q) {
    q = q.toLowerCase();
    content.querySelectorAll('.record').forEach(el => {
      el.style.display = el.textContent.toLowerCase().includes(q) ? '' : 'none';
    });
  };

  renderNav();
  renderContent();
</script>
</body>
</html>`;
}

/** Construit un résumé texte lisible. */
function buildReadme(data: GdprExport): string {
  const lines: string[] = [];
  lines.push('EXPORT RGPD KOTBO');
  lines.push('='.repeat(60));
  lines.push('');
  lines.push(`Utilisateur      : ${data.meta.username ?? '(inconnu)'}${data.meta.globalName ? ` (${data.meta.globalName})` : ''}`);
  lines.push(`ID Discord       : ${data.meta.userId}`);
  lines.push(`Généré le        : ${new Date(data.meta.generatedAt).toLocaleString('fr-FR')}`);
  lines.push(`Enregistrements  : ${data.meta.totalRecords}`);
  lines.push(`Serveurs         : ${data.meta.guildCount}`);
  lines.push('');
  lines.push('SERVEURS CONCERNÉS');
  lines.push('-'.repeat(60));
  for (const g of data.identity.guilds) lines.push(`  - ${g.name} (${g.id})`);
  if (!data.identity.guilds.length) lines.push('  (aucun)');
  lines.push('');
  lines.push('DÉTAIL PAR CATÉGORIE');
  lines.push('-'.repeat(60));
  for (const cat of data.categories) {
    lines.push('');
    lines.push(`[${cat.label}] - ${cat.count} enregistrement(s)`);
    lines.push(`  ${cat.description}`);
    for (const t of cat.tables) {
      lines.push(`    • ${t.label} : ${t.count}`);
    }
  }
  lines.push('');
  lines.push('='.repeat(60));
  lines.push('Ouvrez index.html dans un navigateur pour explorer les données.');
  lines.push('Le dossier data/ contient un fichier JSON par catégorie.');
  lines.push('raw/export.json contient l\'export complet (lisible par machine).');
  if (data.meta.errors.length) {
    lines.push('');
    lines.push('AVERTISSEMENTS DE COLLECTE');
    lines.push('-'.repeat(60));
    for (const e of data.meta.errors) lines.push(`  ! ${e}`);
  }
  return lines.join('\n');
}

/** Assemble l'archive ZIP complète de l'export RGPD. */
export function buildGdprZip(data: GdprExport): Uint8Array {
  const files: Record<string, Uint8Array> = {};

  files['index.html'] = strToU8(buildIndexHtml(data));
  files['README.txt'] = strToU8(buildReadme(data));
  files['raw/export.json'] = strToU8(stringify(data));

  for (const cat of data.categories) {
    const catPayload: Record<string, unknown> = {
      category: cat.label,
      description: cat.description,
      count: cat.count,
    };
    for (const t of cat.tables) {
      catPayload[t.key] = t.records;
    }
    files[`data/${cat.key}.json`] = strToU8(stringify(catPayload));
  }

  return zipSync(files, { level: 6 });
}
