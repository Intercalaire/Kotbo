/** Modules fun. */
import { authStore } from '../stores/auth.svelte';
import { dashboardRequest } from './client';

// Fun API functions
export async function fetchFunConfig(guildId = authStore.selectedGuildId) {
  return dashboardRequest('/fun', { method: 'GET', guildId, errorContext: 'API Error (Fetch Fun Config):' });
}

export async function updateFunConfig(config, guildId = authStore.selectedGuildId) {
  return dashboardRequest('/fun', { method: 'PATCH', payload: config, guildId, errorContext: 'API Error (Update Fun Config):' });
}

export async function resetCountingGame(guildId = authStore.selectedGuildId) {
  return dashboardRequest('/fun/counting/reset', { method: 'POST', guildId, errorContext: 'API Error (Reset Counting):' });
}

export async function resetGuessNumberGame(guildId = authStore.selectedGuildId) {
  return dashboardRequest('/fun/guess-number/reset', { method: 'POST', guildId, errorContext: 'API Error (Reset Guess Number):' });
}

export async function resetWordChainGame(guildId = authStore.selectedGuildId) {
  return dashboardRequest('/fun/word-chain/reset', { method: 'POST', guildId, errorContext: 'API Error (Reset Word Chain):' });
}

export async function resetEmojiRiddleGame(guildId = authStore.selectedGuildId) {
  return dashboardRequest('/fun/emoji-riddle/reset', { method: 'POST', guildId, errorContext: 'API Error (Reset Emoji Riddle):' });
}

export async function fetchEmojiRiddles(guildId = authStore.selectedGuildId) {
  return dashboardRequest('/fun/emoji-riddles', { method: 'GET', guildId, errorContext: 'API Error (Fetch Emoji Riddles):' });
}

export async function createEmojiRiddle(riddle: { emojis: string; answers: string[] }, guildId = authStore.selectedGuildId) {
  return dashboardRequest('/fun/emoji-riddles', { method: 'POST', payload: riddle, guildId, errorContext: 'API Error (Create Emoji Riddle):' });
}

export async function updateEmojiRiddle(id: string, riddle: { emojis: string; answers: string[] }, guildId = authStore.selectedGuildId) {
  return dashboardRequest(`/fun/emoji-riddles/${encodeURIComponent(id)}`, { method: 'PATCH', payload: riddle, guildId, errorContext: 'API Error (Update Emoji Riddle):' });
}

export async function deleteEmojiRiddle(id: string, guildId = authStore.selectedGuildId) {
  return dashboardRequest(`/fun/emoji-riddles/${encodeURIComponent(id)}`, { method: 'DELETE', guildId, errorContext: 'API Error (Delete Emoji Riddle):' });
}
