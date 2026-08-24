/** GM Portal view keys + Express path map (used by React shell and EJS nav). */
export type GmPortalView = 'dashboard' | 'fte' | 'incentives' | 'catalog';

export const GM_PORTAL_PATHS: Record<GmPortalView, string> = {
  dashboard: '/gm',
  fte: '/gm/fte',
  incentives: '/gm/performance-incentives',
  catalog: '/gm/catalog',
};

export function resolveGmViewFromPath(pathname: string): GmPortalView {
  if (pathname === GM_PORTAL_PATHS.fte || pathname.startsWith(`${GM_PORTAL_PATHS.fte}/`)) {
    return 'fte';
  }
  if (
    pathname === GM_PORTAL_PATHS.incentives ||
    pathname.startsWith(`${GM_PORTAL_PATHS.incentives}/`)
  ) {
    return 'incentives';
  }
  if (
    pathname === GM_PORTAL_PATHS.catalog ||
    pathname.startsWith(`${GM_PORTAL_PATHS.catalog}/`)
  ) {
    return 'catalog';
  }
  return 'dashboard';
}
