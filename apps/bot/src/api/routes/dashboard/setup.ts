/**
 * Parcours de configuration expose a la page « Prise en main ». Le calcul vit
 * dans `services/core/setupJourney.ts`, que l'accueil lit aussi.
 */
import { IncomingMessage, ServerResponse } from 'node:http';
import { Client } from 'discord.js';
import { computeSetupJourney } from '../../../services/core/setupJourney.js';
import { logger } from '../../../utils/logger.js';
import { json, resolveDashboardAccess, type AuthClaims } from '../../shared.js';

import { jsonFailure } from '../../shared/failure.js';
export async function handleSetupRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  parts: string[],
  _url: URL,
  client: Client,
  user: AuthClaims,
): Promise<boolean> {
  if (parts[4] !== 'setup') return false;
  if (req.method !== 'GET' || parts.length !== 5) return false;

  const guildId = parts[3];

  const access = await resolveDashboardAccess(client, guildId, user.userId);
  if (!access.canManageSettings) {
    json(res, 403, { error: 'Accès refusé' });
    return true;
  }

  try {
    const journey = await computeSetupJourney(guildId);
    if (!journey) {
      json(res, 404, { error: 'Serveur introuvable' });
      return true;
    }
    json(res, 200, journey);
  } catch (err) {
    logger.error('SetupAPI', 'Erreur GET setup:', err);
    jsonFailure(res, err, 'Erreur lors du calcul du parcours', 'SetupAPI');
  }
  return true;
}
