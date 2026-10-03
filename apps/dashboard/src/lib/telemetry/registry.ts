import { allPages } from '../config/pages';
import { PAGE_TABS } from '../config/pageTabs';
import { resolveTelemetryPage, type TelemetryPage, type TelemetryPageRegistry } from './pageKey';

/** Le registre des pages et de leurs onglets, source unique de ce que la télémétrie retient. */
const registry: TelemetryPageRegistry = { pages: allPages, tabs: PAGE_TABS };

export function resolveDashboardTelemetryPage(pathname: string): TelemetryPage | null {
  return resolveTelemetryPage(pathname, registry);
}
