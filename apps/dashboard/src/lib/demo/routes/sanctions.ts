/**
 * Routes de démo pour les sanctions, rapports et appels de ban.
 */
import type { SanctionItem, SanctionReportItem } from '@kotbo/contracts';
import { route } from '../backend';
import { demoDb } from '../db';
import { ME } from '../fixtures';
import { sanctionsSeed, auditSeed } from '../stories';

export function registerSanctionsRoutes(): void {
  // GET /api/dashboard/guilds/:id/notifications/features
  route('GET', '/api/dashboard/guilds/:id/notifications/features', () => {
    const features = demoDb.get('feature-configs', () => [
      {
        featureKey: 'sanctions',
        enabled: true,
        channelId: '900000000000000319',
        pingRoleIds: [],
        embedColor: '#da373c',
        template: null,
      },
      {
        featureKey: 'automod',
        enabled: true,
        channelId: '900000000000000319',
        pingRoleIds: [],
        embedColor: '#f0b232',
        template: null,
      },
      {
        featureKey: 'logs',
        enabled: true,
        channelId: '900000000000000319',
        pingRoleIds: [],
        embedColor: null,
        template: null,
      },
      {
        featureKey: 'tickets',
        enabled: true,
        channelId: '900000000000000318',
        pingRoleIds: [],
        embedColor: '#5865f2',
        template: null,
      },
    ]);
    return { features };
  });

  // PATCH /api/dashboard/guilds/:id/notifications/features/:featureKey
  route('PATCH', '/api/dashboard/guilds/:id/notifications/features/:featureKey', ({ params, body }) => {
    const featureKey = params.featureKey;
    demoDb.update<any[]>('feature-configs', () => [], (list) => {
      const idx = list.findIndex((f) => f.featureKey === featureKey);
      if (idx >= 0) {
        list[idx] = { ...list[idx], ...body };
      } else {
        list.push({ featureKey, ...body });
      }
      return list;
    });
    return { success: true };
  });

  // GET /api/dashboard/guilds/:id/appeals/config
  route('GET', '/api/dashboard/guilds/:id/appeals/config', () => {
    const config = demoDb.get('appeals-config', () => ({
      enabled: true,
      notifyOnBanDM: true,
      channelId: '900000000000000318',
      allowedWaitDays: 7,
      cooldownDays: 30,
    }));
    return { config };
  });

  // PUT /api/dashboard/guilds/:id/appeals/config
  route('PUT', '/api/dashboard/guilds/:id/appeals/config', ({ body }) => {
    const config = demoDb.update('appeals-config', () => ({
      enabled: true,
      notifyOnBanDM: true,
      channelId: '900000000000000318',
      allowedWaitDays: 7,
      cooldownDays: 30,
    }), (current) => ({ ...current, ...body }));
    return { config };
  });

  // DELETE /api/dashboard/guilds/:id/sanctions/:sanctionId
  route('DELETE', '/api/dashboard/guilds/:id/sanctions/:sanctionId', ({ params }) => {
    const sanctionId = params.sanctionId;
    demoDb.update<SanctionItem[]>('sanctions', sanctionsSeed, (list) =>
      list.filter((s) => s.id !== sanctionId),
    );
    return { success: true };
  });

  // POST /api/dashboard/guilds/:id/sanctions/reports
  route('POST', '/api/dashboard/guilds/:id/sanctions/reports', ({ body }) => {
    const report: SanctionReportItem = {
      id: `report-${Date.now()}`,
      sanctionId: body?.sanctionId ?? null,
      staffPseudo: ME.username,
      incidentAt: new Date().toISOString(),
      memberPseudo: body?.memberPseudo ?? 'Membre',
      memberReference: body?.memberReference ?? '',
      sanctionType: body?.sanctionType ?? 'WARN',
      sanctionDurationLabel: body?.sanctionDurationLabel ?? null,
      brokenRules: body?.brokenRules ?? 'Règlement général',
      detailedReason: body?.detailedReason ?? '',
      evidenceLinks: body?.evidenceLinks ?? [],
      additionalNotes: body?.additionalNotes ?? null,
      createdByUserId: ME.id,
      createdByTag: ME.username,
      createdAt: new Date().toISOString(),
    };
    demoDb.update<SanctionReportItem[]>('sanction-reports', () => [], (list) => [report, ...list]);
    return { report };
  });
}
