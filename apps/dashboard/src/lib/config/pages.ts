import { m } from '../i18n';

export interface PageConfig {
  name: string;
  icon?: string;
  href: string;
  featureKey?: string;
  /** Affiche le badge BETA dans la sidebar et la bannière page */
  beta?: boolean;
  /** Affiche le badge WIP dans la sidebar et l'overlay page */
  wip?: boolean;
  /** Message custom sur l'overlay WIP (remplace le texte par défaut) */
  wipMessage?: string;
}

export function isPageBeta(page: PageConfig): boolean {
  return page.beta === true;
}

export function isPageWip(page: PageConfig): boolean {
  return page.wip === true;
}

export const generalItems: PageConfig[] = [
  { name: m.nav_home(),           icon: "home",      href: "/",          featureKey: "dashboard", beta: false, wip: false },
  { name: m.nav_pulse(),        icon: "activity",  href: "/pulse",     featureKey: "dashboard", beta: true, wip: false },
  { name: m.nav_inbox(),             icon: "inbox",     href: "/inbox",     featureKey: "inbox", beta: false, wip: false },
  { name: m.nav_analytics(),         icon: "pie-chart", href: "/analytics", featureKey: "analytics", beta: false, wip: false },
];

export const moderationItems: PageConfig[] = [
  { name: m.nav_members(),             icon: "users",         href: "/members",            featureKey: "members", beta: false, wip: false },
  { name: m.nav_sanctions(),           icon: "alert-triangle",href: "/sanctions",          featureKey: "sanctions", beta: false, wip: false },
  { name: m.nav_ban_appeals(),       icon: "gavel",         href: "/appeals",            featureKey: "sanctions", beta: false, wip: false },
  { name: m.nav_automod(),     icon: "shield-alert",  href: "/automod",            featureKey: "automod", beta: false, wip: false },
  { name: m.nav_admin_lock(),          icon: "lock",          href: "/admin-lock",         featureKey: "automod", beta: false, wip: false },
  { name: m.nav_nicknames(),             icon: "filter",        href: "/nickname-moderation",featureKey: "nickname_moderation", beta: false, wip: false },
  { name: m.nav_security_dc(),       icon: "shield",        href: "/double-accounts",    featureKey: "double_accounts", beta: false, wip: false },
  { name: m.nav_raid_protection(),   icon: "shieldwarning", href: "/raid-protection",    featureKey: "raid_protection", beta: false, wip: false },
  { name: m.nav_anti_spam(),         icon: "zap",           href: "/anti-spam",          featureKey: "automod", beta: false, wip: false },
  { name: m.nav_security_audit(),    icon: "shieldcheck",   href: "/security-audit",     featureKey: "raid_protection", beta: false, wip: false },
  { name: m.nav_invitations(),         icon: "link",          href: "/invitations",        featureKey: "members", beta: false, wip: false },
  { name: m.nav_discord_logs(),        icon: "file-text",     href: "/logs",              featureKey: "logs", beta: false, wip: false },
  { name: m.nav_message_search(),  icon: "search",        href: "/message-search",    featureKey: "logs", beta: false, wip: false },
  { name: m.nav_transcripts(),      icon: "file",          href: "/transcripts-list",  featureKey: "tickets", beta: false, wip: false },
  { name: m.nav_activity_log(),  icon: "history",       href: "/activity",          featureKey: "activity", beta: false, wip: false },
  { name: m.nav_events(),          icon: "zap",           href: "/events",            featureKey: "events", beta: false, wip: false },
  { name: m.nav_forms(),         icon: "clipboard",     href: "/forms",             featureKey: "events", beta: false, wip: false },
  { name: m.nav_daily_algo(),          icon: "code",          href: "/dailyalgo",         featureKey: "daily_algo", beta: false, wip: false },
];

export const levelingItems: PageConfig[] = [
  { name: m.nav_leveling(),       icon: "trophy",        href: "/leveling",         featureKey: "leveling", beta: false, wip: false },
  { name: m.nav_seasons(),             icon: "flag",          href: "/seasons",          featureKey: "leveling", beta: false, wip: false },
  { name: m.nav_reputation(),          icon: "star",          href: "/reputation",       featureKey: "leveling", beta: false, wip: false },
  { name: m.nav_clans(),               icon: "shield",        href: "/clans",            featureKey: "leveling", beta: true, wip: false },
];

export const economyItems: PageConfig[] = [
  { name: m.nav_economy(),      icon: "coins",         href: "/economy",          featureKey: "economy",  beta: false, wip: false },
  { name: m.nav_marketplace(),              icon: "shopping-bag",  href: "/marketplace",      featureKey: "economy",  beta: false, wip: false },
  { name: m.nav_quests(),              icon: "compass",       href: "/quests",           featureKey: "economy",  beta: false, wip: false },
];

export const communityItems: PageConfig[] = [
  { name: m.nav_giveaways(),           icon: "sparkles",      href: "/giveaways",        featureKey: "giveaways", beta: false, wip: false },
  { name: m.nav_announcements(), icon: "megaphone",    href: "/announcement",     featureKey: "welcome_goodbye", beta: false, wip: false },
  { name: m.nav_reaction_roles(),      icon: "mouse-pointer", href: "/reaction-roles",   featureKey: "reaction_roles", beta: false, wip: false },
  { name: m.nav_triggers(),        icon: "git-branch",    href: "/triggers",         featureKey: "workflows", beta: false, wip: true },
  { name: m.nav_suggestions(),         icon: "thumbs-up",     href: "/suggestions",      featureKey: "suggestions", beta: false, wip: false },
  { name: m.nav_embeds(),              icon: "file-plus",     href: "/embed-builder",    featureKey: "embed_builder", beta: false, wip: false },
  { name: m.nav_regulation(),           icon: "book",          href: "/regulation",       featureKey: "regulation", beta: false, wip: false },
  { name: m.nav_news(),    icon: "rss",           href: "/news",             featureKey: "news", beta: false, wip: false },
  { name: m.nav_fun_channels(),          icon: "smile",         href: "/fun",              featureKey: "fun",  beta: false, wip: false },
  { name: m.nav_social_networks(),     icon: "share-2",       href: "/social-networks",  featureKey: "social_networks", beta: true, wip: false },
];

export const staffItems: PageConfig[] = [
  { name: m.nav_staff_directory(),            icon: "users",         href: "/staff-management/members", featureKey: "staff_directory", beta: false, wip: false },
  { name: m.nav_staff_hierarchy(),  icon: "shield",        href: "/staff-management/roles",   featureKey: "staff_roles", beta: false, wip: false },
  { name: m.nav_recruitment(),         icon: "user-plus",     href: "/recruitment",      featureKey: "recruitment", beta: false, wip: false },
  { name: m.nav_tickets(), icon: "message-square",href: "/tickets",          featureKey: "tickets", beta: false, wip: false },
// { name: m.nav_staff_evaluations(),   icon: "award",         href: "/evaluations",      featureKey: "staff_directory", beta: true, wip: false },
  { name: m.nav_tutoring(),             icon: "book-open",     href: "/tutoring",         featureKey: "tutoring", beta: false, wip: false },
  { name: m.nav_meetings(),            icon: "users",         href: "/meetings",         featureKey: "meetings", beta: false, wip: false },
  { name: m.nav_planning(),            icon: "calendar",      href: "/planning",         featureKey: "absences", beta: false, wip: false },
  { name: m.nav_polls(),            icon: "bar-chart",     href: "/staff-management/polls",    featureKey: "polls", beta: false, wip: false },
  { name: m.nav_discipline(),          icon: "alert-circle",  href: "/staff-management/warnings", featureKey: "discipline", beta: false, wip: false },
];

export const crossServerItems: PageConfig[] = [
  { name: m.nav_channel_links(),        icon: "link",          href: "/channel-links",      featureKey: "channel_links", beta: false, wip: false },
  { name: m.nav_staff_servers(),         icon: "shield",        href: "/staff-server",       featureKey: "staff_server", beta: false, wip: false },
];

export const configItems: PageConfig[] = [
  { name: m.nav_modules(),             icon: "package",       href: "/modules",              featureKey: "modules", beta: false, wip: false },
  { name: m.nav_server_template(),     icon: "sparkles",      href: "/server-template",      featureKey: "settings", beta: true, wip: false },
  { name: m.nav_channel_health(),        icon: "activity",      href: "/channel-health",       featureKey: "channel_health", beta: true, wip: false },
  { name: m.nav_channels(),              icon: "hash",          href: "/channels-management",  featureKey: "auto_thread", beta: false, wip: false },
  { name: m.nav_commands(),           icon: "terminal",      href: "/command-access",       featureKey: "commands", beta: false, wip: false },
  { name: m.nav_settings(),          icon: "settings",      href: "/settings",             featureKey: "settings", beta: false, wip: false },
  { name: m.nav_backups(),         icon: "archive",        href: "/backups",              featureKey: "settings", beta: false, wip: false },
  { name: m.nav_schedules(),      icon: "calendar",      href: "/schedules",            featureKey: "settings", beta: false, wip: false },
  { name: m.nav_mcp_api(),             icon: "cpu",           href: "/mcp-settings",         featureKey: "settings", beta: false, wip: false },
  { name: m.nav_custom_bot(),          icon: "bot",           href: "/custom-bot",           featureKey: "settings", beta: false, wip: true, wipMessage: m.nav_custom_bot_wip() },
];

export const otherPages: PageConfig[] = [
  { name: m.nav_administration(),      icon: "lock",          href: "/admin",                beta: false, wip: false },
  { name: m.nav_my_profile(),          icon: "user",          href: "/profile",              beta: false, wip: false },
  { name: m.nav_user_settings(), icon: "settings",   href: "/userSettings",         beta: false, wip: false },
];

export const allPages: PageConfig[] = [
  ...generalItems,
  ...moderationItems,
  ...levelingItems,
  ...economyItems,
  ...communityItems,
  ...staffItems,
  ...crossServerItems,
  ...configItems,
  ...otherPages
];

export function getPageStatus(path: string, url: string = path): { beta: boolean; wip: boolean; name: string; wipMessage?: string } | null {
  for (const page of allPages) {
    const [pPath, pQuery] = page.href.split('?');
    if (pQuery) {
      if (path === pPath && url.includes(pQuery)) {
        return { beta: isPageBeta(page), wip: isPageWip(page), name: page.name, wipMessage: page.wipMessage };
      }
    } else {
      if (path === pPath || (pPath !== '/' && path.startsWith(`${pPath}/`))) {
        return { beta: isPageBeta(page), wip: isPageWip(page), name: page.name, wipMessage: page.wipMessage };
      }
    }
  }
  return null;
}
