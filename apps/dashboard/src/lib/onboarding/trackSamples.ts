/** L'apercu Discord de chaque piste, pour son « i ». */
import { m } from '../i18n';
import type { TrackKey } from './tracks';

type Sample = { channel: string; title: string; body: string; button?: string };

export const TRACK_SAMPLES: Record<TrackKey, () => Sample> = {
  structure: () => ({ channel: m.onb_info_structure_channel(), title: m.onb_info_structure_title(), body: m.onb_info_structure_body() }),
  moderation: () => ({ channel: m.onb_info_moderation_channel(), title: m.onb_info_moderation_title(), body: m.onb_info_moderation_body() }),
  logs: () => ({ channel: m.onb_info_logs_channel(), title: m.onb_info_logs_title(), body: m.onb_info_logs_body() }),
  greeting: () => ({ channel: m.onb_info_greeting_channel(), title: m.onb_info_greeting_title(), body: m.onb_info_greeting_body() }),
  rules: () => ({ channel: m.onb_info_rules_channel(), title: m.onb_info_rules_title(), body: m.onb_info_rules_body() }),
  tickets: () => ({ channel: m.onb_info_tickets_channel(), title: m.onb_info_tickets_title(), body: m.onb_info_tickets_body(), button: m.onb_info_tickets_button() }),
  levels: () => ({ channel: m.onb_info_levels_channel(), title: m.onb_info_levels_title(), body: m.onb_info_levels_body() }),
  economy: () => ({ channel: m.onb_info_economy_channel(), title: m.onb_info_economy_title(), body: m.onb_info_economy_body() }),
  animation: () => ({ channel: m.onb_info_animation_channel(), title: m.onb_info_animation_title(), body: m.onb_info_animation_body(), button: m.onb_info_animation_button() }),
  staff: () => ({ channel: m.onb_info_staff_channel(), title: m.onb_info_staff_title(), body: m.onb_info_staff_body() }),
  mcp: () => ({ channel: m.onb_info_mcp_channel(), title: m.onb_info_mcp_title(), body: m.onb_info_mcp_body() }),
};
