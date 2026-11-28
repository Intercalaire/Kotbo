/** Ce qu'est chaque ligne de la correspondance, et ce qu'on y verra sur Discord. */
import { m } from '../i18n';

export const LINE_INFO: Record<string, () => { description: string; sample: string }> = {
  'role.member': () => ({ description: m.onb_line_role_member_desc(), sample: m.onb_line_role_member_sample() }),
  'security.honeypot': () => ({ description: m.onb_line_security_honeypot_desc(), sample: m.onb_line_security_honeypot_sample() }),
  'role.staff': () => ({ description: m.onb_line_role_staff_desc(), sample: m.onb_line_role_staff_sample() }),
  'staff.general': () => ({ description: m.onb_line_staff_general_desc(), sample: m.onb_line_staff_general_sample() }),
  'staff.log': () => ({ description: m.onb_line_staff_log_desc(), sample: m.onb_line_staff_log_sample() }),
  'tickets.panel': () => ({ description: m.onb_line_tickets_panel_desc(), sample: m.onb_line_tickets_panel_sample() }),
  'tickets.logs': () => ({ description: m.onb_line_tickets_logs_desc(), sample: m.onb_line_tickets_logs_sample() }),
  'welcome.welcome': () => ({ description: m.onb_line_welcome_welcome_desc(), sample: m.onb_line_welcome_welcome_sample() }),
  'welcome.rules': () => ({ description: m.onb_line_welcome_rules_desc(), sample: m.onb_line_welcome_rules_sample() }),
  'stats.members': () => ({ description: m.onb_line_stats_members_desc(), sample: m.onb_line_stats_members_sample() }),
  'stats.online': () => ({ description: m.onb_line_stats_online_desc(), sample: m.onb_line_stats_online_sample() }),
  'text.general': () => ({ description: m.onb_line_text_general_desc(), sample: m.onb_line_text_general_sample() }),
  'text.media': () => ({ description: m.onb_line_text_media_desc(), sample: m.onb_line_text_media_sample() }),
  'text.random': () => ({ description: m.onb_line_text_random_desc(), sample: m.onb_line_text_random_sample() }),
  'fun.memes': () => ({ description: m.onb_line_fun_memes_desc(), sample: m.onb_line_fun_memes_sample() }),
  'fun.games': () => ({ description: m.onb_line_fun_games_desc(), sample: m.onb_line_fun_games_sample() }),
  'fun.music': () => ({ description: m.onb_line_fun_music_desc(), sample: m.onb_line_fun_music_sample() }),
  'fun.starboard': () => ({ description: m.onb_line_fun_starboard_desc(), sample: m.onb_line_fun_starboard_sample() }),
  'bots.rpg': () => ({ description: m.onb_line_bots_rpg_desc(), sample: m.onb_line_bots_rpg_sample() }),
  'bots.level': () => ({ description: m.onb_line_bots_level_desc(), sample: m.onb_line_bots_level_sample() }),
  'voice.general': () => ({ description: m.onb_line_voice_general_desc(), sample: m.onb_line_voice_general_sample() }),
  'voice.generator': () => ({ description: m.onb_line_voice_generator_desc(), sample: m.onb_line_voice_generator_sample() }),
};
