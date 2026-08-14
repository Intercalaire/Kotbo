// Kotbo - Widget stats staff pour iOS (app Scriptable)
//
// Installation :
//   1. Installe l'app gratuite « Scriptable » depuis l'App Store
//   2. Crée un nouveau script, nomme-le « Kotbo » et colle ce fichier
//   3. Appui long sur l'écran d'accueil → ajoute un widget Scriptable (petit ou moyen)
//   4. Appui long sur le widget → « Modifier le widget » :
//        Script    = Kotbo
//        Parameter = TON_TOKEN|https://ton-instance-kotbo
//      Le token se trouve sur la page Widget du dashboard Kotbo (section
//      « Widgets téléphone & PC »). La partie après « | » est l'URL de l'API
//      (celle du dashboard, sans slash final).
//
// Le widget se rafraîchit automatiquement (~15-30 min, géré par iOS).

const ACCENT = new Color('#00E5FF');
const BG_TOP = new Color('#003366');
const BG_BOTTOM = new Color('#001A33');
const TEXT = new Color('#E6EDF6');
const SUBTLE = new Color('#9FB3C8');

const param = (args.widgetParameter || '').trim();
const [token, apiBaseRaw] = param.split('|').map((s) => (s || '').trim());
const apiBase = (apiBaseRaw || 'https://kotbo.fr').replace(/\/$/, '');

async function fetchStats() {
  const req = new Request(`${apiBase}/api/public/widget-data`);
  req.headers = { Authorization: `Bearer ${token}` };
  return await req.loadJSON();
}

function baseWidget() {
  const w = new ListWidget();
  const gradient = new LinearGradient();
  gradient.colors = [BG_TOP, BG_BOTTOM];
  gradient.locations = [0, 1];
  w.backgroundGradient = gradient;
  w.setPadding(14, 16, 14, 16);
  return w;
}

function addStat(stack, label, value) {
  const col = stack.addStack();
  col.layoutVertically();
  const l = col.addText(label.toUpperCase());
  l.font = Font.semiboldSystemFont(8);
  l.textColor = SUBTLE;
  const v = col.addText(value);
  v.font = Font.boldSystemFont(16);
  v.textColor = TEXT;
}

async function buildWidget() {
  const w = baseWidget();

  if (!token) {
    const t = w.addText('Kotbo');
    t.font = Font.boldSystemFont(16);
    t.textColor = TEXT;
    w.addSpacer(4);
    const help = w.addText('Configure le paramètre du widget : TOKEN|https://ton-api');
    help.font = Font.systemFont(11);
    help.textColor = SUBTLE;
    return w;
  }

  let stats;
  try {
    stats = await fetchStats();
  } catch {
    stats = null;
  }

  if (!stats || !stats.user) {
    const t = w.addText('Kotbo - hors ligne');
    t.font = Font.boldSystemFont(14);
    t.textColor = TEXT;
    w.addSpacer(4);
    const help = w.addText('Impossible de récupérer les stats. Vérifie le token et l\'URL.');
    help.font = Font.systemFont(11);
    help.textColor = SUBTLE;
    return w;
  }

  // En-tête : icône serveur + nom + rang
  const header = w.addStack();
  header.centerAlignContent();
  if (stats.server.iconUrl) {
    try {
      const icon = await new Request(stats.server.iconUrl).loadImage();
      const iconEl = header.addImage(icon);
      iconEl.imageSize = new Size(24, 24);
      iconEl.cornerRadius = 6;
      header.addSpacer(8);
    } catch {
      // Icône indisponible : on affiche seulement le texte
    }
  }
  const headText = header.addStack();
  headText.layoutVertically();
  const name = headText.addText(stats.server.name);
  name.font = Font.boldSystemFont(14);
  name.textColor = TEXT;
  const rank = headText.addText(`${stats.user.staffRank} · ${stats.server.memberCount.toLocaleString('fr-FR')} membres`);
  rank.font = Font.systemFont(9);
  rank.textColor = SUBTLE;

  w.addSpacer(10);

  // Stats sur deux lignes
  const row1 = w.addStack();
  addStat(row1, 'Niveau', `${stats.user.level} lvl`);
  row1.addSpacer();
  addStat(row1, 'Messages', stats.user.messageCount.toLocaleString('fr-FR'));
  w.addSpacer(8);
  const row2 = w.addStack();
  addStat(row2, 'Vocal', `${stats.user.voiceMinutes.toLocaleString('fr-FR')} min`);
  row2.addSpacer();
  addStat(row2, 'Score', `${stats.user.staffScore} pts`);

  w.addSpacer(10);
  const footer = w.addText(`Kotbo · ${new Date(stats.updatedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`);
  footer.font = Font.systemFont(8);
  footer.textColor = ACCENT;

  return w;
}

const widget = await buildWidget();
if (config.runsInWidget) {
  Script.setWidget(widget);
} else {
  widget.presentMedium();
}
Script.complete();
