/**
 * Ce que le dashboard envoie de lui-même (télémétrie, rapports d'erreur,
 * retours) : absorbé sans rien transmettre. Une démo publique n'écrit dans
 * aucune base, et ces appels n'ont aucun effet visible pour le visiteur.
 */
import { route } from '../backend';

export function registerTelemetryRoutes(): void {
  route('POST', '/api/dashboard/telemetry', () => undefined);
  route('POST', '/api/report-error', () => undefined);
}
