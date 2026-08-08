/**
 * Discord Social Layer SDK - Profile Widget for Kotbo
 *
 * Usage:
 *   bun run apps/bot/scripts/linked-roles.ts push <userId>
 *   bun run apps/bot/scripts/linked-roles.ts clear <userId>
 *
 * Prereqs:
 *   1. Enable Social SDK in Developer Portal → Games → Social SDK
 *   2. User must authorize via the OAuth2 URL printed by this script
 *
 * Env vars (from .env): DISCORD_TOKEN, DISCORD_CLIENT_ID
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(currentDir, "../../../.env") });
loadEnv({ path: path.resolve(currentDir, "../.env") });

const BOT_TOKEN = process.env.DISCORD_TOKEN ?? "";
const APP_ID = process.env.DISCORD_CLIENT_ID ?? "";

if (!BOT_TOKEN || !APP_ID) {
  console.error("DISCORD_TOKEN et DISCORD_CLIENT_ID requis dans .env");
  process.exit(1);
}

const API = "https://discord.com/api/v9";

// ─── Types ────────────────────────────────────────────────────────────────────

interface DynamicField {
  type: 1 | 2 | 3;
  name: string;
  value: string | number | { url: string };
}

interface WidgetPayload {
  username: string;
  data: { dynamic: DynamicField[] };
}

// ─── Build widget data ────────────────────────────────────────────────────────

function buildWidgetData(overrides: {
  username: string;
  serverName: string;
  serverLogoUrl: string;
  membersCount: string;
  staffRank: string;
  staffSince: string;
  staffRankHero: string;
  statMessageImage: string;
  statMessageTitle: string;
  statMessageDesc: string;
  statVocalImage: string;
  statVocalTitle: string;
  statVocalDesc: string;
  levelImage: string;
  levelTitle: string;
  levelDesc: string;
  staffScoreImage: string;
  staffScoreTitle: string;
  staffScoreDesc: string;
}): WidgetPayload {
  return {
    username: overrides.username,
    data: {
      dynamic: [
        { type: 3, name: "serveur.logo", value: { url: overrides.serverLogoUrl } },
        { type: 1, name: "user.staffRank", value: overrides.staffRank },
        { type: 1, name: "server.name", value: overrides.serverName },
        { type: 1, name: "serveur.membersCount", value: overrides.membersCount },
        { type: 1, name: "user.staffSinceTo", value: overrides.staffSince },
        { type: 3, name: "user.statMessage.image", value: { url: overrides.statMessageImage } },
        { type: 1, name: "user.statMessage.title", value: overrides.statMessageTitle },
        { type: 1, name: "user.statMessage.description", value: overrides.statMessageDesc },
        { type: 3, name: "user.statVocal.image", value: { url: overrides.statVocalImage } },
        { type: 1, name: "user.statVocal.title", value: overrides.statVocalTitle },
        { type: 1, name: "user.statVocal.description", value: overrides.statVocalDesc },
        { type: 3, name: "user.level.image", value: { url: overrides.levelImage } },
        { type: 1, name: "user.level.title", value: overrides.levelTitle },
        { type: 1, name: "user.level.description", value: overrides.levelDesc },
        { type: 3, name: "user.statStaffScore.image", value: { url: overrides.staffScoreImage } },
        { type: 1, name: "user.statStaffScore.title", value: overrides.staffScoreTitle },
        { type: 1, name: "user.statStaffScore.description", value: overrides.staffScoreDesc },
        { type: 1, name: "user.staffRankHero", value: overrides.staffRankHero },
      ],
    },
  };
}

// ─── PATCH widget profile ─────────────────────────────────────────────────────

async function patchWidgetProfile(userId: string, payload: WidgetPayload) {
  const url = `${API}/applications/${APP_ID}/users/${userId}/identities/${encodeURIComponent(userId)}/profile`;

  console.log("[Widget] PATCH", url);

  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bot ${BOT_TOKEN}`,
      "User-Agent": "DiscordBot (https://kotbo.fr, 1.0.0)",
    },
    body: JSON.stringify(payload),
  });

  const body = await res.text();

  if (!res.ok) {
    console.error(`[Widget] Échec ${res.status}:`, body);
    process.exit(1);
  }

  console.log("[Widget] Mis à jour avec succès :", body || "(204 No Content)");
}

// ─── Clear widget profile ─────────────────────────────────────────────────────

async function clearWidgetProfile(userId: string) {
  const url = `${API}/applications/${APP_ID}/users/${userId}/identities/${encodeURIComponent(userId)}/profile`;

  console.log("[Widget] DELETE", url);

  const res = await fetch(url, {
    method: "DELETE",
    headers: {
      Authorization: `Bot ${BOT_TOKEN}`,
      "User-Agent": "DiscordBot (https://kotbo.fr, 1.0.0)",
    },
  });

  if (!res.ok) {
    const body = await res.text();
    console.error(`[Widget] Échec suppression ${res.status}:`, body);
    process.exit(1);
  }

  console.log("[Widget] Profil widget supprimé");
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

const [command, userId] = process.argv.slice(2);

if (!command || !userId) {
  const baseRedirect = process.env.DISCORD_REDIRECT_URI ?? "http://localhost:8787/api/auth/discord/callback";
  const loginUrl = `${new URL(baseRedirect).origin}/api/auth/discord/login`;

  console.log(`Usage:
  bun run apps/bot/scripts/linked-roles.ts push <userId>    # Pousse les données widget
  bun run apps/bot/scripts/linked-roles.ts clear <userId>   # Supprime le widget

Prérequis:
  1. Activer Social SDK : Developer Portal → Games → Social SDK
  2. L'utilisateur doit se connecter au dashboard (les scopes widget sont inclus dans le login) :

     ${loginUrl}

Variables d'env (dans .env) :
  DISCORD_TOKEN      - Token du bot
  DISCORD_CLIENT_ID  - ID de l'application
`);
  process.exit(0);
}

if (command === "push") {
  const payload = buildWidgetData({
    username: userId,
    serverName: "Azuria",
    serverLogoUrl: "https://kotbo.fr/assets/azuria-logo.png",
    membersCount: "1 250 membres",
    staffRank: "Fondateur",
    staffSince: "01/01/2024",
    staffRankHero: "Fondateur",
    statMessageImage: "https://cdn.discordapp.com/emojis/1519265291849170994.png",
    statMessageTitle: "Messages",
    statMessageDesc: "12 450 messages envoyés",
    statVocalImage: "https://cdn.discordapp.com/emojis/1519265313911345234.png",
    statVocalTitle: "Vocal",
    statVocalDesc: "340h en vocal",
    levelImage: "https://cdn.discordapp.com/emojis/1519265285251792927.png",
    levelTitle: "Niveau 42",
    levelDesc: "15 200 XP",
    staffScoreImage: "https://cdn.discordapp.com/emojis/1519265302968406096.png",
    staffScoreTitle: "Score Staff",
    staffScoreDesc: "98/100",
  });

  await patchWidgetProfile(userId, payload);
} else if (command === "clear") {
  await clearWidgetProfile(userId);
} else {
  console.error(`Commande inconnue : "${command}". Utilise "push" ou "clear".`);
  process.exit(1);
}
