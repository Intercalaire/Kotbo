import {
  SlashCommandBuilder,
  MessageFlags,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { joinFieldEntries, kotboContainer } from '../../utils/embeds.js';
import { E, buildProgressBar } from '../../utils/emojis.js';
import { getAvailableQuests } from '../../services/community/questService.js';
import { getMemberQuests } from '../../services/features/rpg/rpgQuestService.js';
import type { SlashCommandDefinition } from '../../commands.js';
import { ContainerChild, separator, v2Message } from '@arcscord/components';
import { ExtractArrayValue } from '../../utils/types.js';
import { getEffectiveLocale, getCommandMetadata } from '../../utils/i18n.js';
import * as m from '../../lib/paraglide/messages.js';

const meta = getCommandMetadata('c4_quests');

const data = new SlashCommandBuilder()
  .setName(meta.name)
  .setNameLocalizations(meta.nameLocalizations)
  .setDescription(meta.description)
  .setDescriptionLocalizations(meta.descriptionLocalizations)
  .addSubcommand((sub) =>
    sub.setName('list')
      .setDescription(m.c4_quests_list_desc({}, { locale: 'en' }))
      .setDescriptionLocalizations({ fr: m.c4_quests_list_desc({}, { locale: 'fr' }) }));

async function execute(interaction: ChatInputCommandInteraction) {
  const subcommand = interaction.options.getSubcommand();
  const guildId = interaction.guildId!;
  const userId = interaction.user.id;
  const locale = await getEffectiveLocale(interaction);

  if (subcommand === 'list') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const [quests, rpgQuests] = await Promise.all([
      getAvailableQuests(guildId, userId),
      getMemberQuests(interaction.client, guildId, userId),
    ]);

    if (quests.length === 0 && rpgQuests.length === 0) {

      await interaction.editReply(v2Message(
        kotboContainer({
          color: 'dark',
          title: `${E.fire} ${m.c4_quests_title({}, { locale })}`,
          fields: [
            `${E.info} ${m.c4_quests_none({}, { locale })}`,
          ],
          footerTitle: m.c4_quests_title({}, { locale })
        })
      ));
      return;
    }

    type Quest = ExtractArrayValue<
      Awaited<
        ReturnType<
          typeof getAvailableQuests
        >
      >
    >;

    const daily = quests.filter((q) => q.frequency === 'DAILY');
    const weekly = quests.filter((q) => q.frequency === 'WEEKLY');

    const formatQuest = (q: Quest) => {
      const progress = q.progress;
      const pct = Math.min((progress.current / progress.target) * 100, 100);
      const bar = buildProgressBar(pct, 8);
      const statusIcon = progress.status === 'CLAIMED' ? E.success
        : progress.status === 'COMPLETED' ? E.star
        : E.dot;
      const rewards = [];
      if (q.rewardCoins > 0) rewards.push(`${q.rewardCoins} ${E.coins}`);
      if (q.rewardXp > 0) rewards.push(`${q.rewardXp} ${E.xp}`);
      return `${statusIcon} **${q.name}**\n${q.description}\n${bar} \`${progress.current}/${progress.target}\` - ${rewards.join(' + ')}`;
    };

    const formatRpgQuest = (q: Awaited<ReturnType<typeof getMemberQuests>>[number]) => {
      const pct = Math.min((q.current / q.target) * 100, 100);
      const bar = buildProgressBar(pct, 8);
      const statusIcon = q.status === 'CLAIMED' ? E.success : q.status === 'COMPLETED' ? E.star : E.dot;
      const rewards = [];
      if (q.rewardCoins > 0) rewards.push(`${q.rewardCoins} ${E.coins}`);
      if (q.rewardXp > 0) rewards.push(`${q.rewardXp} ${E.xp}`);
      const team = q.teamName ? ` - ${q.teamName}` : '';
      const ends = `<t:${Math.floor(q.endsAt.getTime() / 1000)}:R>`;
      return `${statusIcon} ${q.emoji} **${q.name}**${team}\n${q.description}\n${bar} \`${q.current}/${q.target}\` - ${rewards.join(' + ')} - ${ends}`;
    };

    const rpgPersonal = rpgQuests.filter((q) => q.scope === 'MEMBER');
    const rpgTeam = rpgQuests.filter((q) => q.scope === 'TEAM');

    const fields: ContainerChild[] = [];

    // Discord refuse un message Components V2 dont le texte affichable cumulé dépasse
    // 4000 caractères. Les descriptions de quête sont libres et peuvent, à elles
    // seules, faire déborder ce budget une fois toutes les catégories assemblées :
    // on répartit donc un budget fixe entre les catégories présentes plutôt que de
    // tout afficher sans limite.
    const QUEST_LIST_TEXT_BUDGET = 3400;
    const sections = [
      { header: `**${E.calendar} ${m.c4_quests_daily({}, { locale })}**`, entries: daily.map(formatQuest) },
      { header: `**${E.calendar} ${m.c4_quests_weekly({}, { locale })}**`, entries: weekly.map(formatQuest) },
      { header: `**${E.crown} ${m.c4_quests_rpg({}, { locale })}**`, entries: rpgPersonal.map(formatRpgQuest) },
      { header: `**${E.shield} ${m.c4_quests_rpg_team({}, { locale })}**`, entries: rpgTeam.map(formatRpgQuest) },
    ].filter((section) => section.entries.length > 0);

    const perSectionBudget = Math.floor(QUEST_LIST_TEXT_BUDGET / Math.max(sections.length, 1));

    for (const section of sections) {
      fields.push(
        separator({ divider: true, spacing: 'small' }),
        section.header,
        joinFieldEntries(section.entries, {
          more: (count) => m.c4_quests_more({ count }, { locale }),
          separator: '\n\n',
          max: perSectionBudget,
        })
      );
    }

    await interaction.editReply(v2Message(
      kotboContainer({
        color: 'primary',
        title: `${E.fire} ${m.c4_quests_title({}, { locale })}`,
        fields,
        footerTitle: m.c4_quests_title({}, { locale })
      })
    ));
  }
}

export const questsCommand = { data, execute } satisfies SlashCommandDefinition;
