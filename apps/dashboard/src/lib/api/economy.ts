/** Economie et RPG. */
import { authStore } from '../stores/auth.svelte';
import { dashboardMutation, dashboardRequest } from './client';

import type { RpgItemPayload } from '@kotbo/contracts';
import { m } from '../i18n';
// ==========================================
// ECONOMY & RPG APIs
// ==========================================
export async function fetchEconomyConfig(guildId = authStore.selectedGuildId) {
  return dashboardRequest('/economy/config', { method: 'GET', guildId, errorContext: 'API Error (Fetch Economy Config):' });
}

export async function updateEconomyConfig(config: Record<string, unknown>, guildId = authStore.selectedGuildId) {
  return dashboardRequest('/economy/config', { method: 'PATCH', successMessage: m.api_ok_update_economy_config(), payload: config, guildId, errorContext: 'API Error (Update Economy Config):' });
}

export async function fetchRpgItems(guildId = authStore.selectedGuildId) {
  return dashboardRequest('/economy/items', { method: 'GET', guildId, errorContext: 'API Error (Fetch RPG Items):' });
}

export async function saveRpgItem(item: RpgItemPayload, guildId = authStore.selectedGuildId) {
  return dashboardRequest('/economy/items', { method: 'POST', successMessage: m.api_ok_save_rpg_item(), payload: item, guildId, errorContext: 'API Error (Save RPG Item):' });
}

export async function deleteRpgItem(itemId: string, guildId = authStore.selectedGuildId) {
  return dashboardRequest(`/economy/items/${itemId}`, { method: 'DELETE', successMessage: m.api_ok_delete_rpg_item(), guildId, errorContext: 'API Error (Delete RPG Item):' });
}

export async function fetchRpgMonsters(guildId = authStore.selectedGuildId) {
  return dashboardRequest('/economy/monsters', { method: 'GET', guildId, errorContext: 'API Error (Fetch RPG Monsters):' });
}

export async function saveRpgMonster(monster: Record<string, unknown>, guildId = authStore.selectedGuildId) {
  return dashboardRequest('/economy/monsters', { method: 'POST', successMessage: m.api_ok_save_rpg_monster(), payload: monster, guildId, errorContext: 'API Error (Save RPG Monster):' });
}

export async function setRpgMonsterEnabled(monsterId: string, enabled: boolean, guildId = authStore.selectedGuildId) {
  return dashboardRequest(`/economy/monsters/${monsterId}`, { method: 'PATCH', successMessage: m.api_ok_set_rpg_monster_enabled(), payload: { enabled }, guildId, errorContext: 'API Error (Toggle RPG Monster):' });
}

export async function deleteRpgMonster(monsterId: string, guildId = authStore.selectedGuildId) {
  return dashboardRequest(`/economy/monsters/${monsterId}`, { method: 'DELETE', successMessage: m.api_ok_delete_rpg_monster(), guildId, errorContext: 'API Error (Delete RPG Monster):' });
}

export async function applyRpgBestiaryDifficulty(
  scope: 'boss' | 'monster',
  difficulty: string,
  options: { preview?: boolean } = {},
  guildId = authStore.selectedGuildId,
) {
  return dashboardRequest('/economy/monsters/difficulty', {
    method: 'POST',
    successMessage: m.api_ok_apply_rpg_bestiary_difficulty(),
    payload: { scope, difficulty, preview: options.preview === true },
    guildId,
    // Un essai a blanc ne doit pas annoncer une operation reussie : rien n'a bouge.
    silent: options.preview === true,
    errorContext: 'API Error (Apply RPG Bestiary Difficulty):',
  });
}

export async function applyRpgShopDifficulty(
  difficulty: string,
  options: { preview?: boolean } = {},
  guildId = authStore.selectedGuildId,
) {
  return dashboardRequest('/economy/items/difficulty', {
    method: 'POST',
    successMessage: m.api_ok_apply_rpg_shop_difficulty(),
    payload: { difficulty, preview: options.preview === true },
    guildId,
    silent: options.preview === true,
    errorContext: 'API Error (Apply RPG Shop Difficulty):',
  });
}

export async function exportRpgBestiary(guildId = authStore.selectedGuildId) {
  return dashboardRequest('/economy/monsters/export', { method: 'GET', guildId, errorContext: 'API Error (Export RPG Bestiary):' });
}

export async function importRpgBestiary(payload: unknown, guildId = authStore.selectedGuildId) {
  return dashboardRequest('/economy/monsters/import', { method: 'POST', successMessage: m.api_ok_import_rpg_bestiary(), payload, guildId, errorContext: 'API Error (Import RPG Bestiary):' });
}

export async function fetchRpgRaid(guildId = authStore.selectedGuildId) {
  return dashboardRequest('/economy/raid', { method: 'GET', guildId, errorContext: 'API Error (Fetch RPG Raid):' });
}

export async function saveRpgRaidBoss(boss: Record<string, unknown>, guildId = authStore.selectedGuildId) {
  return dashboardRequest('/economy/raid/bosses', { method: 'POST', successMessage: m.api_ok_save_rpg_raid_boss(), payload: boss, guildId, errorContext: 'API Error (Save RPG Raid Boss):' });
}

export async function deleteRpgRaidBoss(bossId: string, guildId = authStore.selectedGuildId) {
  return dashboardRequest(`/economy/raid/bosses/${bossId}`, { method: 'DELETE', successMessage: m.api_ok_delete_rpg_raid_boss(), guildId, errorContext: 'API Error (Delete RPG Raid Boss):' });
}

export async function startRpgRaid(guildId = authStore.selectedGuildId) {
  return dashboardRequest('/economy/raid/start', { method: 'POST', successMessage: m.api_ok_start_rpg_raid(), payload: {}, guildId, errorContext: 'API Error (Start RPG Raid):' });
}

export async function restoreRpgRaidBosses(guildId = authStore.selectedGuildId) {
  return dashboardRequest('/economy/raid/seed', { method: 'POST', successMessage: m.api_ok_restore_rpg_raid_bosses(), payload: {}, guildId, errorContext: 'API Error (Restore RPG Raid Bosses):' });
}

export async function fetchRpgQuests(guildId = authStore.selectedGuildId) {
  return dashboardRequest('/economy/quests', { method: 'GET', guildId, errorContext: 'API Error (Fetch RPG Quests):' });
}

export async function saveRpgQuest(quest: Record<string, unknown>, guildId = authStore.selectedGuildId) {
  return dashboardRequest('/economy/quests', { method: 'POST', successMessage: m.api_ok_save_rpg_quest(), payload: quest, guildId, errorContext: 'API Error (Save RPG Quest):' });
}

export async function deleteRpgQuest(questId: string, guildId = authStore.selectedGuildId) {
  return dashboardRequest(`/economy/quests/${questId}`, { method: 'DELETE', successMessage: m.api_ok_delete_rpg_quest(), guildId, errorContext: 'API Error (Delete RPG Quest):' });
}

export async function fetchRpgRecipes(guildId = authStore.selectedGuildId) {
  return dashboardRequest('/economy/recipes', { method: 'GET', guildId, errorContext: 'API Error (Fetch RPG Recipes):' });
}

export async function saveRpgRecipe(recipe: Record<string, unknown>, guildId = authStore.selectedGuildId) {
  return dashboardRequest('/economy/recipes', { method: 'POST', successMessage: m.api_ok_save_rpg_recipe(), payload: recipe, guildId, errorContext: 'API Error (Save RPG Recipe):' });
}

export async function deleteRpgRecipe(recipeId: string, guildId = authStore.selectedGuildId) {
  return dashboardRequest(`/economy/recipes/${recipeId}`, { method: 'DELETE', successMessage: m.api_ok_delete_rpg_recipe(), guildId, errorContext: 'API Error (Delete RPG Recipe):' });
}

export async function fetchRpgPlayers(guildId = authStore.selectedGuildId) {
  return dashboardRequest('/economy/players', { method: 'GET', guildId, errorContext: 'API Error (Fetch RPG Players):' });
}

export async function updateRpgPlayer(userId: string, payload: Record<string, unknown>, guildId = authStore.selectedGuildId) {
  return dashboardRequest(`/economy/players/${userId}`, { method: 'PATCH', successMessage: m.api_ok_update_rpg_player(), payload, guildId, errorContext: 'API Error (Update RPG Player):' });
}

export async function fetchRpgPlayerInventory(userId: string, guildId = authStore.selectedGuildId) {
  return dashboardRequest(`/economy/players/${userId}/inventory`, { method: 'GET', guildId, errorContext: 'API Error (Fetch RPG Player Inventory):' });
}

export async function grantRpgPlayerItem(userId: string, itemId: string, quantity: number, guildId = authStore.selectedGuildId) {
  return dashboardRequest(`/economy/players/${userId}/inventory`, { method: 'POST', successMessage: m.api_ok_grant_rpg_item(), payload: { itemId, quantity }, guildId, errorContext: 'API Error (Grant RPG Item):' });
}

export async function removeRpgPlayerItem(userId: string, itemId: string, quantity: number, guildId = authStore.selectedGuildId) {
  return dashboardRequest(`/economy/players/${userId}/inventory/${itemId}?quantity=${quantity}`, { method: 'DELETE', successMessage: m.api_ok_remove_rpg_item(), guildId, errorContext: 'API Error (Remove RPG Item):' });
}

export async function fetchRpgEvents(guildId = authStore.selectedGuildId) {
  return dashboardRequest('/economy/events', { method: 'GET', guildId, errorContext: 'API Error (Fetch RPG Events):' });
}

export async function saveRpgEvent(event: Record<string, unknown>, guildId = authStore.selectedGuildId) {
  return dashboardRequest('/economy/events', { method: 'POST', successMessage: m.api_ok_save_rpg_event(), payload: event, guildId, errorContext: 'API Error (Save RPG Event):' });
}

export async function setRpgEventEnabled(eventId: string, enabled: boolean, guildId = authStore.selectedGuildId) {
  return dashboardRequest(`/economy/events/${eventId}`, { method: 'PATCH', successMessage: m.api_ok_set_rpg_event_enabled(), payload: { enabled }, guildId, errorContext: 'API Error (Toggle RPG Event):' });
}

export async function deleteRpgEvent(eventId: string, guildId = authStore.selectedGuildId) {
  return dashboardRequest(`/economy/events/${eventId}`, { method: 'DELETE', successMessage: m.api_ok_delete_rpg_event(), guildId, errorContext: 'API Error (Delete RPG Event):' });
}

export async function fetchRpgGuilds(guildId = authStore.selectedGuildId) {
  return dashboardRequest('/economy/guilds', { method: 'GET', guildId, errorContext: 'API Error (Fetch RPG Guilds):' });
}

export async function updateRpgGuild(rpgGuildId: string, payload: Record<string, unknown>, guildId = authStore.selectedGuildId) {
  return dashboardRequest(`/economy/guilds/${rpgGuildId}`, { method: 'PATCH', successMessage: m.api_ok_update_rpg_guild(), payload, guildId, errorContext: 'API Error (Update RPG Guild):' });
}

export async function removeRpgGuildMember(rpgGuildId: string, userId: string, guildId = authStore.selectedGuildId) {
  return dashboardRequest(`/economy/guilds/${rpgGuildId}/members/${userId}`, { method: 'DELETE', successMessage: m.api_ok_remove_rpg_guild_member(), guildId, errorContext: 'API Error (Remove RPG Guild Member):' });
}

export async function dissolveRpgGuild(rpgGuildId: string, guildId = authStore.selectedGuildId) {
  return dashboardRequest(`/economy/guilds/${rpgGuildId}`, { method: 'DELETE', successMessage: m.api_ok_dissolve_rpg_guild(), guildId, errorContext: 'API Error (Dissolve RPG Guild):' });
}

export async function resetEconomy(component: 'all' | 'profiles' | 'items' | 'config' | 'guilds' | 'bestiary', guildId = authStore.selectedGuildId) {
  return dashboardRequest('/economy/reset', { method: 'POST', successMessage: m.api_ok_reset_economy(), payload: { component }, guildId, errorContext: 'API Error (Reset Economy):' });
}

export async function updateSanctionTables(tables, guildId = authStore.selectedGuildId) {
  return dashboardMutation('/sanctions/tables', {
    method: 'PUT',
    payload: tables,
    guildId,
    errorContext: 'API Error (Update Sanction Tables):'
  });
}

// ── MCP API Keys ────────────────────────────────────────────────────────────
