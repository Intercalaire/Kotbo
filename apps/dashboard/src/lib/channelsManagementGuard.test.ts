import { describe, test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Garde-fous de la page ChannelsManagement.svelte.
 *
 * Quatre defauts que AUCUN test unitaire classique ne peut voir : la page est
 * un composant Svelte, le depot n'a pas de harnais de rendu, donc personne ne
 * monte cette page dans un test. Ils sont lus ici directement DANS LA SOURCE,
 * comme le fait deja `styleGuard.test.ts` (meme motif, rien a installer).
 *
 * Ce sont exactement les quatre defauts qui reviendraient a la prochaine
 * modification de la page, parce que rien dans la chaine ne les refuse :
 *
 *  G1 - un noeud de texte francais code en dur. Le client a retenu
 *       L'ANGLAIS : `en.json` fait foi et TOUT texte affiche passe par
 *       `m.<cle>()` (paraglide). Un libelle tape a la main reste en francais
 *       pour tout le monde, dans les deux langues.
 *       QUAND IL TOMBE : deplacer le texte dans `en.json` + `fr.json` (meme
 *       cle, prefixe `cm_`), puis appeler `m.<cle>()` a la place.
 *
 *  G2 - `as any` sur la charge envoyee a `updateChannelsManagementConfig`.
 *       Le cast eteint le controle de types sur TOUTE la charge : un champ
 *       mal nomme (`stateColor` au lieu de `stateColors`) part au serveur
 *       sans que ni le typecheck ni le test ne bronchent, et le reglage
 *       parait simplement inoperant cote bot.
 *       QUAND IL TOMBE : typer la charge (etendre le type d'entree de l'API
 *       avec les champs manquants) au lieu de la caster.
 *
 *  G3 - la regle « l'etat est-il rendu nativement ? » recopiee dans le
 *       balisage, et amputee. Le bot (`etatRenduNativement`, dans
 *       apps/bot/src/events/tempVoice.ts) decide avec la disposition ET la
 *       teinte : l'image n'apparait que si l'admin a choisi autre chose que
 *       le defaut livre. La page, elle, teste `stateLayout === 'GRID3' &&
 *       panelComponents === 'V1'` et ignore `stateColors` : elle grise le
 *       selecteur de teinte et affiche « natif » dans des cas ou le bot
 *       envoie en realite une image. Recopiee a trois endroits, la condition
 *       redivergera du bot a la premiere retouche.
 *       QUAND IL TOMBE : une SEULE source de verite dans le `<script>`
 *       (`const etatNatif = $derived(...)`) qui mentionne `stateColors`,
 *       et le balisage ne reference plus que ce nom.
 *
 *  G4 - le bouton « Create automatically » du honeypot reaffecte
 *       `savedConfig` EN ENTIER. Il ne vient de creer qu'un salon : tout le
 *       reste du formulaire peut etre modifie et non enregistre. Recopier
 *       `config` dans `savedConfig` declare ces modifications sauvegardees,
 *       la garde de sortie (`useUnsavedChanges`) se taira et le travail
 *       partira a la navigation suivante.
 *       QUAND IL TOMBE : ne reporter QUE le champ resolu
 *       (`savedConfig.honeypotChannelId = ...`), comme le fait deja le
 *       basculement `autoThreadEnabled`.
 */
const PAGE = join(import.meta.dir, '..', 'pages', 'ChannelsManagement.svelte');
const source = readFileSync(PAGE, 'utf-8');

/** Frontiere script / balisage : la regle vit dans l'un, s'utilise dans l'autre. */
const COUPE = source.lastIndexOf('</script>');
const script = source.slice(0, COUPE);
const balisage = source.slice(COUPE);

/** Numero de ligne d'un decalage, pour que l'echec soit directement navigable. */
function ligne(decalage: number): number {
  return source.slice(0, decalage).split('\n').length;
}

/**
 * Fin (exclue) du bloc ouvert par la premiere `ouvre` rencontree a partir de
 * `depuis`. Suffisant ici : ni les charges d'appel ni les gestionnaires
 * `onclick` de cette page ne contiennent de parenthese ou d'accolade
 * desequilibree dans une chaine.
 */
function finBloc(depuis: number, ouvre: string, ferme: string): number {
  const debut = source.indexOf(ouvre, depuis);
  if (debut < 0) return source.length;
  let profondeur = 0;
  for (let i = debut; i < source.length; i++) {
    if (source[i] === ouvre) profondeur++;
    else if (source[i] === ferme && --profondeur === 0) return i + 1;
  }
  return source.length;
}

/** Tous les appels a `nom(...)`, corps complet et position. */
function appels(nom: string): { debut: number; texte: string }[] {
  const trouves: { debut: number; texte: string }[] = [];
  let depuis = 0;
  for (;;) {
    const i = source.indexOf(`${nom}(`, depuis);
    if (i < 0) return trouves;
    const fin = finBloc(i, '(', ')');
    trouves.push({ debut: i, texte: source.slice(i, fin) });
    depuis = fin;
  }
}

describe('ChannelsManagement : garde-fous', () => {
  test('le garde-fou lit bien la page', () => {
    expect(source.length).toBeGreaterThan(50_000);
    expect(COUPE).toBeGreaterThan(0);
  });

  /**
   * G1. Accents echappes (`é`) et tolerance `[eé]` : une comparaison
   * de textes accentues casse des deux cotes selon l'encodage du fichier de
   * test, un motif ASCII ne casse jamais.
   */
  test('G1 : aucun texte francais code en dur (tout passe par m.*())', () => {
    const TEXTES = [
      'Fonctionnalit[eé]s par salon',
      'Filtrer un salon',
      'Aucun salon ne correspond',
      'Ce salon porte aussi',
      'Message coll[eé]',
      'G[eé]n[eé]rateur vocal',
      'Salon renomm[eé]',
      'Salon supprim[eé]',
      'Renommer',
      'Supprimer',
    ];
    // Un appel `m.<cle>()` n'est pas un texte : la cle est un identifiant, le
    // texte vit dans en.json / fr.json. On le retire avant de chercher.
    const sansTraduction = source.replace(/\bm\.[A-Za-z0-9_]+\([^()]*\)/g, '');
    const fautifs: string[] = [];
    for (const motif of TEXTES) {
      const regex = new RegExp(motif, 'g');
      let m: RegExpExecArray | null;
      while ((m = regex.exec(sansTraduction)) !== null) {
        fautifs.push(`${motif} -> ${sansTraduction.slice(0, m.index).split('\n').length}`);
      }
    }
    if (fautifs.length > 0) {
      throw new Error(
        `Textes francais codes en dur (motif -> ligne, hors appel m.*()) :\n  ${fautifs.join('\n  ')}\n` +
        'Deplacer chacun dans en.json + fr.json et appeler m.<cle>().',
      );
    }
  });

  test('G2 : aucun `as any` sur la charge de updateChannelsManagementConfig', () => {
    const fautifs = appels('updateChannelsManagementConfig')
      .filter(({ texte }) => /\bas\s+any\b/.test(texte))
      .map(({ debut }) => `ligne ${ligne(debut)}`);
    if (fautifs.length > 0) {
      throw new Error(
        `updateChannelsManagementConfig appele avec un cast \`as any\` : ${fautifs.join(', ')}.\n` +
        'Le cast eteint le controle de types sur toute la charge : typer la charge a la place.',
      );
    }
  });

  test("G3 : la regle d'etat natif est unique et tient compte de stateColors", () => {
    const CONDITION_DEUX_TERMES =
      /(?:stateLayout\s*===\s*['"]GRID3['"]\s*&&\s*[\w.?]*panelComponents\s*===\s*['"]V1['"])|(?:panelComponents\s*===\s*['"]V1['"]\s*&&\s*[\w.?]*stateLayout\s*===\s*['"]GRID3['"])/g;
    const recopies = balisage.match(CONDITION_DEUX_TERMES)?.length ?? 0;
    if (recopies > 0) {
      throw new Error(
        `La condition « GRID3 && V1 » est ecrite ${recopies} fois dans le balisage.\n` +
        'Elle doit vivre a UN seul endroit dans le <script> ; le balisage ne reference que ce nom.',
      );
    }

    // La regle du bot (`etatRenduNativement`) compare la disposition ET la
    // teinte. Un `;` ne coupe jamais une expression booleenne : decouper le
    // script par `;` isole chaque declaration sans dependre de sa forme
    // ($derived, fonction, ternaire).
    const NATIF = /===\s*['"]GRID3['"]/;
    const complete = script
      .split(';')
      .some((instruction) => NATIF.test(instruction) && instruction.includes('stateColors'));
    if (!complete) {
      throw new Error(
        "Aucune instruction du <script> ne teste 'GRID3' en mentionnant stateColors.\n" +
        'Le bot (etatRenduNativement, apps/bot/src/events/tempVoice.ts) decide avec la\n' +
        'disposition ET la teinte : sans stateColors, la page grise le selecteur de teinte\n' +
        'et annonce « natif » alors que le bot envoie une image.',
      );
    }
  });

  test('G4 : « Create automatically » (honeypot) ne reaffecte pas savedConfig en entier', () => {
    const marqueur = source.indexOf('createHoneypotChannel');
    expect(marqueur).toBeGreaterThan(0);
    // Le gestionnaire entier, depuis le `onclick={` qui le precede.
    const ouverture = source.lastIndexOf('onclick={', marqueur);
    expect(ouverture).toBeGreaterThan(0);
    const gestionnaire = source.slice(ouverture, finBloc(ouverture, '{', '}'));

    const REAFFECTATION = /savedConfig\s*=\s*JSON\.parse\(\s*JSON\.stringify\(\s*config\s*\)\s*\)/;
    if (REAFFECTATION.test(gestionnaire)) {
      throw new Error(
        `Le gestionnaire « Create automatically » (ligne ${ligne(ouverture)}) recopie tout \`config\`\n` +
        'dans `savedConfig`. Il ne cree qu\'un salon : tout reglage modifie et non enregistre est\n' +
        'alors declare sauvegarde, la garde de sortie se tait et le travail est perdu.\n' +
        'Ne reporter que le champ resolu : savedConfig.honeypotChannelId = res.resolved.honeypotChannelId.',
      );
    }
  });
});
