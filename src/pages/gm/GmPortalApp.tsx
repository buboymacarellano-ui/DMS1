import React, { useCallback, useMemo, useState } from 'react';
import Dashboard, { type DashboardNavigateOptions } from './Dashboard';
import DmsCatalog from './DmsCatalog';
import FteDashboard from './FteDashboard';
import { FTE_MOCK_DASHBOARD } from './fteMockData';
import { GM_PORTAL_PATHS, resolveGmViewFromPath, type GmPortalView } from './gmRoutes';

export type GmPortalAppProps = {
  initialView?: GmPortalView;
  initialPath?: string;
  /** Session / mock role: GM | STM | SA | SR */
  currentUserRole?: string;
  currentUserBranch?: string;
};

function readOpenLogFlag(search?: string): boolean {
  if (typeof window === 'undefined' && !search) return false;
  try {
    const params = new URLSearchParams(
      search ?? (typeof window !== 'undefined' ? window.location.search : '')
    );
    return params.get('log') === '1';
  } catch {
    return false;
  }
}

function normalizePortalRole(role: string): string {
  return String(role || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z]/g, '');
}

/**
 * Lightweight portal view router (no react-router dependency).
 * Switches between Dashboard (GM / STM / SA / SR), FteDashboard, and DmsCatalog.
 */
export default function GmPortalApp({
  initialView,
  initialPath = typeof window !== 'undefined' ? window.location.pathname : '/gm',
  currentUserRole = 'GM',
  currentUserBranch = 'ALL',
}: GmPortalAppProps) {
  const roleKey = normalizePortalRole(currentUserRole);
  const isStm = roleKey === 'STM' || roleKey === 'SERVICETECHNICALMANAGER';
  const isSa = roleKey === 'SA' || roleKey === 'SERVICEADVISOR';
  const isSr =
    roleKey === 'SR' ||
    roleKey === 'SERVICEREPRESENTATIVE' ||
    roleKey === 'SERVICERECEPTIONIST';
  const isSsr = roleKey === 'SSR' || roleKey === 'SENIORSERVICERECEPTIONIST';
  const isFrontline = isSa || isSr || isSsr;

  const dashboardVariant = isSsr ? 'ssr' : isSr ? 'sr' : isSa ? 'sa' : isStm ? 'stm' : 'gm';
  const homePath = isFrontline
    ? '/service-receptionist'
    : isStm
      ? '/stm'
      : '/gm';

  const [view, setView] = useState<GmPortalView>(
    () => initialView ?? resolveGmViewFromPath(initialPath)
  );
  const [openLogModal, setOpenLogModal] = useState(() => readOpenLogFlag());

  const fteRole = useMemo(() => {
    if (roleKey === 'GENERALMANAGER' || roleKey === 'GM') return 'GM';
    if (isStm) return 'STM';
    if (isSa) return 'SA';
    if (isSsr) return 'SSR';
    if (isSr) return 'SR';
    return currentUserRole;
  }, [currentUserRole, isSa, isSr, isSsr, isStm, roleKey]);

  // SA/SR FTE focus branch is CebuCity.
  const scopedBranch = isFrontline ? 'CebuCity' : isStm ? currentUserBranch || 'CebuCity' : 'ALL';

  const handleNavigate = useCallback(
    (next: GmPortalView, options?: DashboardNavigateOptions) => {
      const shouldOpenLog = Boolean(options?.openLogModal);
      setOpenLogModal(shouldOpenLog);
      setView(next);
      if (typeof window !== 'undefined' && window.history?.pushState) {
        let path = homePath;
        if (next === 'fte') path = shouldOpenLog ? `${GM_PORTAL_PATHS.fte}?log=1` : GM_PORTAL_PATHS.fte;
        else if (next === 'incentives') path = GM_PORTAL_PATHS.incentives;
        else if (next === 'catalog') path = GM_PORTAL_PATHS.catalog;
        window.history.pushState({ gmView: next, openLogModal: shouldOpenLog }, '', path);
      }
    },
    [homePath]
  );

  if (view === 'fte') {
    return (
      <FteDashboard
        {...FTE_MOCK_DASHBOARD}
        currentUserRole={fteRole}
        currentUserBranch={scopedBranch}
        initialModalOpen={openLogModal}
        onBack={() => handleNavigate('dashboard')}
        onLogIssue={() => undefined}
      />
    );
  }

  if (view === 'catalog') {
    return <DmsCatalog onBack={() => handleNavigate('dashboard')} />;
  }

  return (
    <Dashboard
      variant={dashboardVariant}
      assignedBranch={isFrontline ? 'CebuCity' : undefined}
      onNavigate={handleNavigate}
      workOrdersCount={12}
      customersCount={48}
      vehiclesCount={36}
    />
  );
}
