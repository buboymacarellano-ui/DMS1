import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GM_PORTAL_PATHS, type GmPortalView } from './gmRoutes';

const TIMELINE_DURATIONS = ['H', 'D', 'W', 'M', 'Y', 'ALL'] as const;
export type TimelineDuration = (typeof TIMELINE_DURATIONS)[number];

type BranchMetricStatus = 'ok' | 'watch' | 'alert';

type BranchMetricRow = {
  branch: string;
  openWorkOrders: number;
  liveAccumulatedRevenue: number;
  targetPacingPct: number;
  laborGrossMarginPct: number;
  partsGrossMarginPct: number;
  statusWarning: string;
  statusWarningCode: BranchMetricStatus;
};

type DashboardCards = {
  revenueLabel: string;
  revenueValue: number;
  revenueDelta: string;
  cumulativeLabel: string;
  cumulativeValue: number;
  cumulativeDelta: string;
  pendingBillingCount: number;
  pendingSpark: number[];
  avgTicket: number;
};

type DashboardPacing = {
  avgPacing: number;
  segA: number;
  segB: number;
  segC: number;
};

type DashboardMatrixTotals = {
  openWorkOrders: number;
  liveAccumulatedRevenue: number;
  targetPacingPct: number;
  laborGrossMarginPct: number;
  partsGrossMarginPct: number;
};

const BRANCH_TARGET_NAMES = ['Carx2', 'Carmen', 'CebuCity', 'Lapux2', 'Bogo', 'Toledo', 'ITPark'] as const;

const DEFAULT_BRANCH_SALES_TARGETS: Record<(typeof BRANCH_TARGET_NAMES)[number], number> = {
  Carx2: 1800000,
  Carmen: 1500000,
  CebuCity: 2500000,
  Lapux2: 2600000,
  Bogo: 2000000,
  Toledo: 1600000,
  ITPark: 1700000,
};

type BranchSalesTargets = {
  monthKey?: string;
  monthLabel?: string;
  branches?: Partial<Record<(typeof BRANCH_TARGET_NAMES)[number], number>>;
};

export type DashboardMetricsPayload = {
  duration?: TimelineDuration | string;
  reporting?: { date?: string; label?: string };
  branchSalesTargets?: BranchSalesTargets;
  cards?: Partial<DashboardCards>;
  pacing?: Partial<DashboardPacing>;
  matrix?: {
    rows?: BranchMetricRow[];
    totals?: Partial<DashboardMatrixTotals>;
  };
};

const DEFAULT_SPARK = [36, 52, 44, 70, 58, 82, 64];

function normalizeDuration(value: string | null | undefined): TimelineDuration {
  const code = String(value || 'D').trim().toUpperCase();
  return (TIMELINE_DURATIONS as readonly string[]).includes(code) ? (code as TimelineDuration) : 'D';
}

/**
 * Attaches click listeners to the H/D/W/M/Y/ALL timeline buttons.
 * Fetches `/api/dashboard/metrics?duration=&date=` and returns a cleanup.
 */
export function setupTimelineFilters(options: {
  root?: HTMLElement | null;
  getDate: () => string;
  onDuration: (duration: TimelineDuration) => void;
  onPayload: (payload: DashboardMetricsPayload) => void;
  onError?: (error: unknown) => void;
}): () => void {
  const root = options.root || (typeof document !== 'undefined'
    ? document.getElementById('gm-timeline-filters')
    : null);
  if (!root) return () => undefined;

  const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>('button[data-duration]'));
  if (!buttons.length) return () => undefined;

  let inFlight = false;

  const setActive = (duration: TimelineDuration) => {
    buttons.forEach((button) => {
      const isActive = normalizeDuration(button.getAttribute('data-duration')) === duration;
      button.classList.toggle('is-active', isActive);
      button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
    options.onDuration(duration);
  };

  const handleClick = async (event: Event) => {
    const button = event.currentTarget as HTMLButtonElement;
    const duration = normalizeDuration(button.getAttribute('data-duration'));
    setActive(duration);
    if (inFlight) return;
    inFlight = true;
    buttons.forEach((item) => { item.disabled = true; });
    try {
      const params = new URLSearchParams();
      params.set('duration', duration);
      const date = options.getDate();
      if (date) params.set('date', date);
      const response = await fetch(`/api/dashboard/metrics?${params.toString()}`, {
        headers: { Accept: 'application/json' },
        credentials: 'same-origin',
      });
      if (!response.ok) {
        throw new Error('Unable to load dashboard metrics');
      }
      const payload = (await response.json()) as DashboardMetricsPayload;
      options.onPayload(payload);
    } catch (error) {
      if (options.onError) options.onError(error);
      else console.error(error);
    } finally {
      inFlight = false;
      buttons.forEach((item) => { item.disabled = false; });
    }
  };

  buttons.forEach((button) => button.addEventListener('click', handleClick));
  return () => {
    buttons.forEach((button) => button.removeEventListener('click', handleClick));
  };
}

export type DashboardNavigateOptions = {
  /** Deep-link into FteDashboard with the transaction entry modal open. */
  openLogModal?: boolean;
};

export type DashboardProps = {
  reportingDate?: string;
  reportingLabel?: string;
  todayRevenue?: number;
  weeklyRevenue?: number;
  pendingBillingCount?: number;
  avgTicket?: number;
  /**
   * `gm` — manager analytics shell
   * `stm` — STM top-card workspace
   * `sa` / `sr` — full work-order dashboards; FTE via 4th shortcut card
   */
  variant?: 'gm' | 'stm' | 'sa' | 'sr' | 'ssr';
  assignedBranch?: string;
  workOrdersCount?: number;
  customersCount?: number;
  vehiclesCount?: number;
  /** Client-side view switch (preferred when hosted inside GmPortalApp). */
  onNavigate?: (view: GmPortalView, options?: DashboardNavigateOptions) => void;
  /** Optional full-page navigation fallback (Express / hard route). */
  navigateHref?: (view: GmPortalView, options?: DashboardNavigateOptions) => string;
};

function formatPeso(value: number): string {
  const amount = Number.isFinite(value) ? value : 0;
  return `₱ ${amount.toLocaleString('en-PH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

const branchMetricsData: BranchMetricRow[] = [
  {
    branch: 'Carx2',
    openWorkOrders: 2,
    liveAccumulatedRevenue: 9320,
    targetPacingPct: 28,
    laborGrossMarginPct: 48.5,
    partsGrossMarginPct: 51.5,
    statusWarning: 'Watch',
    statusWarningCode: 'watch',
  },
  {
    branch: 'Carmen',
    openWorkOrders: 3,
    liveAccumulatedRevenue: 12110,
    targetPacingPct: 36,
    laborGrossMarginPct: 42,
    partsGrossMarginPct: 58,
    statusWarning: 'Watch',
    statusWarningCode: 'watch',
  },
  {
    branch: 'CebuCity',
    openWorkOrders: 6,
    liveAccumulatedRevenue: 24680.5,
    targetPacingPct: 68.4,
    laborGrossMarginPct: 55,
    partsGrossMarginPct: 45,
    statusWarning: 'OK',
    statusWarningCode: 'ok',
  },
  {
    branch: 'Lapux2',
    openWorkOrders: 4,
    liveAccumulatedRevenue: 18450,
    targetPacingPct: 52,
    laborGrossMarginPct: 61.2,
    partsGrossMarginPct: 38.8,
    statusWarning: 'OK',
    statusWarningCode: 'ok',
  },
  {
    branch: 'Bogo',
    openWorkOrders: 5,
    liveAccumulatedRevenue: 15200.75,
    targetPacingPct: 44,
    laborGrossMarginPct: 58.3,
    partsGrossMarginPct: 41.7,
    statusWarning: 'OK',
    statusWarningCode: 'ok',
  },
  {
    branch: 'Toledo',
    openWorkOrders: 1,
    liveAccumulatedRevenue: 4100,
    targetPacingPct: 16,
    laborGrossMarginPct: 70,
    partsGrossMarginPct: 30,
    statusWarning: 'Alert',
    statusWarningCode: 'alert',
  },
  {
    branch: 'ITPark',
    openWorkOrders: 0,
    liveAccumulatedRevenue: 7800.25,
    targetPacingPct: 40,
    laborGrossMarginPct: 64.8,
    partsGrossMarginPct: 35.2,
    statusWarning: 'OK',
    statusWarningCode: 'ok',
  },
];

function clampPct(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

const MATRIX_BLUE_FADE = 'linear-gradient(to right, rgba(78, 205, 232, 0.38), rgba(78, 205, 232, 0))';
const MATRIX_BLUE_FADE_LEFT = 'linear-gradient(to left, rgba(184, 230, 76, 0.34), rgba(184, 230, 76, 0))';

/** Right-fading blue density bar; fill width = open work orders / 6. */
function openWorkOrdersCellStyle(value: number): React.CSSProperties {
  const weight = clampPct((Number(value) / 6) * 100);
  return {
    backgroundImage: MATRIX_BLUE_FADE,
    backgroundSize: `${weight}% 100%`,
    backgroundRepeat: 'no-repeat',
    backgroundPosition: 'left center',
  };
}

/** Right-fading blue progress wash; fill width matches raw pacing %. */
function targetPacingCellStyle(pacing: number): React.CSSProperties {
  const weight = clampPct(pacing);
  return {
    backgroundImage: MATRIX_BLUE_FADE,
    backgroundSize: `${weight}% 100%`,
    backgroundRepeat: 'no-repeat',
    backgroundPosition: 'left center',
  };
}

const pacingCapsuleStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: '#b8e64c',
  color: '#10243d',
  borderRadius: 999,
  padding: '2px 8px',
  fontWeight: 700,
  fontSize: 11,
  lineHeight: 1.2,
};

/** Left-fading blue density plot; fill width = structural margin weight. */
function marginDensityCellStyle(pct: number): React.CSSProperties {
  const weight = clampPct(pct);
  return {
    backgroundImage: MATRIX_BLUE_FADE_LEFT,
    backgroundSize: `${weight}% 100%`,
    backgroundRepeat: 'no-repeat',
    backgroundPosition: 'right center',
  };
}

/**
 * Dashboard shell — GM dense view, STM cards, or SA/SR work-order dashboards.
 * SA/SR open FTE Tracking via the 4th top shortcut card (CebuCity-locked destination).
 */
export default function Dashboard({
  reportingDate = '2026-08-13',
  reportingLabel = 'Aug 13, 2026',
  todayRevenue = 0,
  weeklyRevenue = 0,
  pendingBillingCount = 0,
  avgTicket = 0,
  variant = 'gm',
  assignedBranch = 'CebuCity',
  workOrdersCount = 0,
  customersCount = 0,
  vehiclesCount = 0,
  onNavigate,
  navigateHref = (view, options) => {
    const base = GM_PORTAL_PATHS[view];
    if (view === 'fte' && options?.openLogModal) return `${base}?log=1`;
    return base;
  },
}: DashboardProps) {
  const [dateValue, setDateValue] = useState(reportingDate);
  const [activeDuration, setActiveDuration] = useState<TimelineDuration>('D');
  const [matrixRows, setMatrixRows] = useState<BranchMetricRow[]>(branchMetricsData);
  const [cardMetrics, setCardMetrics] = useState<DashboardCards>(() => ({
    revenueLabel: `Revenue on ${reportingLabel}`,
    revenueValue: todayRevenue,
    revenueDelta: '▲ Daily close',
    cumulativeLabel: `Week Through ${reportingLabel}`,
    cumulativeValue: weeklyRevenue,
    cumulativeDelta: '▲ Week to date',
    pendingBillingCount,
    pendingSpark: DEFAULT_SPARK,
    avgTicket,
  }));
  const [pacingMix, setPacingMix] = useState<DashboardPacing | null>(null);
  const [targetsOpen, setTargetsOpen] = useState(false);
  const [salesTargets, setSalesTargets] = useState<BranchSalesTargets>({
    monthLabel: 'August 2026',
    branches: { ...DEFAULT_BRANCH_SALES_TARGETS },
  });
  const dateValueRef = useRef(dateValue);
  const pillsRef = useRef<HTMLDivElement | null>(null);
  dateValueRef.current = dateValue;
  const isStm = variant === 'stm';
  const isSa = variant === 'sa';
  const isSr = variant === 'sr';
  const isSsr = variant === 'ssr';
  const isFrontlineDash = isSa || isSr || isSsr;
  const fteBranch = assignedBranch || 'CebuCity';

  const applyMetricsPayload = useCallback((payload: DashboardMetricsPayload) => {
    const cards = payload.cards || {};
    setCardMetrics((current) => ({
      revenueLabel: cards.revenueLabel || current.revenueLabel,
      revenueValue: Number(cards.revenueValue ?? current.revenueValue),
      revenueDelta: cards.revenueDelta || current.revenueDelta,
      cumulativeLabel: cards.cumulativeLabel || current.cumulativeLabel,
      cumulativeValue: Number(cards.cumulativeValue ?? current.cumulativeValue),
      cumulativeDelta: cards.cumulativeDelta || current.cumulativeDelta,
      pendingBillingCount: Number(cards.pendingBillingCount ?? current.pendingBillingCount),
      pendingSpark: Array.isArray(cards.pendingSpark) && cards.pendingSpark.length
        ? cards.pendingSpark
        : current.pendingSpark,
      avgTicket: Number(cards.avgTicket ?? current.avgTicket),
    }));
    if (payload.pacing) {
      setPacingMix({
        avgPacing: Number(payload.pacing.avgPacing || 0),
        segA: Number(payload.pacing.segA || 0),
        segB: Number(payload.pacing.segB || 0),
        segC: Number(payload.pacing.segC || 0),
      });
    }
    if (Array.isArray(payload.matrix?.rows)) {
      setMatrixRows(payload.matrix.rows.map((row) => ({
        branch: row.branch || '—',
        openWorkOrders: Number(row.openWorkOrders || 0),
        liveAccumulatedRevenue: Number(row.liveAccumulatedRevenue || 0),
        targetPacingPct: Number(row.targetPacingPct || 0),
        laborGrossMarginPct: Number(row.laborGrossMarginPct || 0),
        partsGrossMarginPct: Number(row.partsGrossMarginPct || 0),
        statusWarning: row.statusWarning || 'OK',
        statusWarningCode: /^(ok|watch|alert)$/i.test(String(row.statusWarningCode || ''))
          ? (String(row.statusWarningCode).toLowerCase() as BranchMetricStatus)
          : 'ok',
      })));
    }
    if (payload.duration) {
      setActiveDuration(normalizeDuration(String(payload.duration)));
    }
    if (payload.branchSalesTargets) {
      setSalesTargets({
        monthLabel: payload.branchSalesTargets.monthLabel || 'August 2026',
        branches: {
          ...DEFAULT_BRANCH_SALES_TARGETS,
          ...(payload.branchSalesTargets.branches || {}),
        },
      });
    }
  }, []);

  useEffect(() => {
    return setupTimelineFilters({
      root: pillsRef.current,
      getDate: () => dateValueRef.current,
      onDuration: setActiveDuration,
      onPayload: applyMetricsPayload,
    });
  }, [applyMetricsPayload]);

  const kpis = useMemo(
    () => [
      {
        id: 'revenue',
        label: cardMetrics.revenueLabel,
        value: formatPeso(cardMetrics.revenueValue),
        delta: cardMetrics.revenueDelta,
      },
      {
        id: 'cumulative',
        label: cardMetrics.cumulativeLabel,
        value: formatPeso(cardMetrics.cumulativeValue),
        delta: cardMetrics.cumulativeDelta,
      },
      {
        id: 'pending',
        label: 'Pending Billing',
        value: String(cardMetrics.pendingBillingCount),
      },
      {
        id: 'ticket',
        label: 'Average Ticket',
        value: formatPeso(cardMetrics.avgTicket),
      },
    ],
    [cardMetrics]
  );

  function go(view: GmPortalView, options?: DashboardNavigateOptions) {
    if (onNavigate) {
      onNavigate(view, options);
      return;
    }
    if (typeof window !== 'undefined') {
      window.location.assign(navigateHref(view, options));
    }
  }

  if (isFrontlineDash) {
    const roleLabel = isSsr ? 'SSR' : isSr ? 'SR' : 'SA';
    return (
      <section className="dashboard-shell gm-shell sa-shell">
        <div className="dashboard-title gm-title role-dashboard-title">
          <span>
            {roleLabel}
            {fteBranch ? ` ${fteBranch}` : ''}
          </span>{' '}
          <span className="role-dashboard-title__suffix">Dashboard</span>
        </div>

        <div className="sa-grid sa-grid--4">
          <article className="gm-kpi-card sa-card">
            <div className="sa-card-title">TRANSACTIONS</div>
            <div className="sa-card-body">
              <p className="sa-line">
                <strong>Open Work Orders:</strong> [{workOrdersCount}]
              </p>
              <p className="sa-line">
                Customers: [{customersCount}] | Vehicles: [{vehiclesCount}]
              </p>
            </div>
            <div className="sa-open-row">
              <a className="btn" href="/work-order-transactions" aria-label="Open Transactions">
                OPEN
              </a>
            </div>
          </article>

          <article className="gm-kpi-card sa-card">
            <div className="sa-card-title">PARTS</div>
            <div className="sa-card-body">
              <p className="sa-line">Transaction &amp; Record Center</p>
              <p className="sa-line">Real-time Stock Levels</p>
            </div>
            <div className="sa-open-row">
              <a className="btn" href="/parts">
                ACCESS DATABASE
              </a>
            </div>
          </article>

          <article className="gm-kpi-card sa-card">
            <div className="sa-card-title">HELPER</div>
            <div className="sa-card-body">
              <p className="sa-line">Search Parts, Customer Info, Technicians, &amp; App Data.</p>
              <p className="sa-line">Integrated Helpdesk &amp; KB.</p>
            </div>
            <div className="sa-open-row">
              <a className="btn" href="/helper">
                SEARCH/OPEN
              </a>
            </div>
          </article>

          <article className="gm-kpi-card sa-card">
            <div className="sa-card-title">FTE WORKSPACE</div>
            <div className="sa-card-body">
              <p className="sa-line">Transaction &amp; Record Center</p>
              <p className="sa-line">
                Real-time Branch Logging: <strong>[{fteBranch}]</strong>
              </p>
            </div>
            <div className="sa-open-row">
              <button
                type="button"
                className="btn"
                aria-label="Open FTE Tracking Panel"
                onClick={() => go('fte')}
              >
                OPEN PANEL
              </button>
            </div>
          </article>
        </div>

        <article className="dashboard-card gm-panel sa-tech-panel sa-tech-panel--fill">
          <div className="dashboard-card__header gm-panel-header">TECHNICIAN</div>
          <p className="dashboard-note">
            Live Technician Summary &amp; MTD Performance Metrics. Customers, vehicles, and work-order
            tools remain available from the cards above.
          </p>
        </article>
      </section>
    );
  }

  if (isStm) {
    return (
      <section className="dashboard-shell gm-shell">
        <div className="stm-action-toolbar" aria-label="STM workspace actions">
          <button
            id="btnRestartTunnel"
            type="button"
            className="px-4 py-2 bg-amber-700 hover:bg-amber-600 text-white rounded font-medium transition shadow flex items-center gap-2"
            onClick={async (event) => {
              event.preventDefault();
              const button = event.currentTarget;
              if (button.disabled) return;
              const confirmed = window.confirm(
                'Confirm tunnel recycle? Remote branch users will lose connectivity for roughly 5 to 10 seconds.'
              );
              if (!confirmed) return;
              const idleHtml = button.innerHTML;
              button.disabled = true;
              button.textContent = 'Recycling Tunnel... Please Wait.';
              let dispatched = false;
              try {
                const response = await fetch('/api/admin/restart-tunnel', {
                  method: 'POST',
                  credentials: 'same-origin',
                  headers: { Accept: 'application/json' },
                });
                dispatched = response.ok;
              } catch {
                dispatched = false;
              }
              window.setTimeout(() => {
                button.disabled = false;
                button.innerHTML = idleHtml;
                window.alert(
                  dispatched
                    ? 'Tunnel command dispatched successfully.'
                    : 'Tunnel recycle failed. Try again or check the server process.'
                );
              }, 5000);
            }}
          >
            <span>🔄</span> Restart Network Tunnel
          </button>
        </div>
        <div className="dashboard-title gm-title role-dashboard-title">
          <span>STM</span> <span className="role-dashboard-title__suffix">Dashboard</span>
        </div>

        <div className="sa-grid sa-grid--4">
          <article className="gm-kpi-card sa-card">
            <div className="sa-card-title">TRANSACTIONS</div>
            <div className="sa-card-body">
              <p className="sa-line">
                <strong>Work Orders:</strong> [{workOrdersCount}]
              </p>
              <p className="sa-line">
                Customers: [{customersCount}] | Vehicles: [{vehiclesCount}]
              </p>
            </div>
            <div className="sa-open-row">
              <a className="btn" href="/work-order-transactions" aria-label="Open Transactions">
                OPEN
              </a>
            </div>
          </article>

          <article className="gm-kpi-card sa-card">
            <div className="sa-card-title">PARTS</div>
            <div className="sa-card-body">
              <p className="sa-line">Transaction &amp; Record Center</p>
              <p className="sa-line">Real-time Stock Levels</p>
            </div>
            <div className="sa-open-row">
              <a className="btn" href="/parts">
                ACCESS DATABASE
              </a>
            </div>
          </article>

          <article className="gm-kpi-card sa-card">
            <div className="sa-card-title">HELPER</div>
            <div className="sa-card-body">
              <p className="sa-line">Search Parts, Customer Info, Technicians, &amp; App Data.</p>
              <p className="sa-line">Integrated Helpdesk &amp; KB.</p>
            </div>
            <div className="sa-open-row">
              <a className="btn" href="/helper">
                SEARCH/OPEN
              </a>
            </div>
          </article>

          <article className="gm-kpi-card sa-card">
            <div className="sa-card-title">FTE</div>
            <div className="sa-card-body">
              <p className="sa-line">Facility, Tool &amp; Equipment Tracking</p>
              <p className="sa-line">Log repairs, PM, and expense issues.</p>
            </div>
            <div className="sa-open-row">
              <button
                type="button"
                className="btn"
                aria-label="Log FTE Issue"
                onClick={() => go('fte', { openLogModal: true })}
              >
                + LOG FTE ISSUE
              </button>
            </div>
          </article>
        </div>
      </section>
    );
  }

  const branchCount = matrixRows.length || 1;
  const matrixTotals = matrixRows.reduce(
    (acc, row) => {
      acc.openWorkOrders += Number(row.openWorkOrders || 0);
      acc.liveAccumulatedRevenue += Number(row.liveAccumulatedRevenue || 0);
      acc.targetPacingPct += Number(row.targetPacingPct || 0);
      acc.laborGrossMarginPct += Number(row.laborGrossMarginPct || 0);
      acc.partsGrossMarginPct += Number(row.partsGrossMarginPct || 0);
      return acc;
    },
    {
      openWorkOrders: 0,
      liveAccumulatedRevenue: 0,
      targetPacingPct: 0,
      laborGrossMarginPct: 0,
      partsGrossMarginPct: 0,
    }
  );
  const avgPacing = pacingMix ? pacingMix.avgPacing : matrixTotals.targetPacingPct / branchCount;
  const avgLabor = matrixTotals.laborGrossMarginPct / branchCount;
  const avgParts = matrixTotals.partsGrossMarginPct / branchCount;
  const segA = pacingMix ? clampPct(pacingMix.segA) : clampPct(avgLabor * 0.45);
  const segB = pacingMix ? clampPct(pacingMix.segB) : clampPct(segA + avgParts * 0.35);
  const segC = pacingMix ? clampPct(pacingMix.segC) : clampPct(segB + avgPacing * 0.35);
  const maxRevenue = Math.max(...matrixRows.map((row) => Number(row.liveAccumulatedRevenue || 0)), 1);
  const statusCounts = matrixRows.reduce(
    (acc, row) => {
      if (row.statusWarningCode === 'alert') acc.alert += 1;
      else if (row.statusWarningCode === 'watch') acc.watch += 1;
      else acc.ok += 1;
      return acc;
    },
    { ok: 0, watch: 0, alert: 0 }
  );
  const sparkHeights = cardMetrics.pendingSpark.length ? cardMetrics.pendingSpark : DEFAULT_SPARK;

  return (
    <section className="dashboard-shell gm-shell gm-shell--dense gm-analytics">
      <div className="gm-analytics__head">
        <div className="dashboard-title gm-title role-dashboard-title">
          <span>GM</span> <span className="role-dashboard-title__suffix">Dashboard</span>
        </div>
        <div className="gm-analytics__controls">
        <div
          className="gm-range-pills"
          id="gm-timeline-filters"
          ref={pillsRef}
          aria-label="Reporting range"
        >
          {TIMELINE_DURATIONS.map((code) => (
            <button
              key={code}
              type="button"
              data-duration={code}
              className={activeDuration === code ? 'is-active' : ''}
              aria-pressed={activeDuration === code}
            >
              {code}
            </button>
          ))}
        </div>
        <div className="gm-reporting-form gm-reporting-form--compact">
          <label htmlFor="gm-reporting-date">Reporting Date</label>
          <input
            id="gm-reporting-date"
            type="date"
            name="date"
            value={dateValue}
            onChange={(event) => setDateValue(event.target.value)}
          />
          <button type="button" className="btn">
            Apply
          </button>
          {!isStm && !isFrontlineDash ? (
            <button
              type="button"
              className="btn gm-dense-link"
              onClick={() => setTargetsOpen((open) => !open)}
            >
              Targets
            </button>
          ) : null}
          <button type="button" className="btn gm-dense-link" onClick={() => go('incentives')}>
            Incentives
          </button>
          <button
            type="button"
            className="btn gm-dense-link"
            onClick={() => go('catalog')}
            aria-label="Open DEMO DMS DX Catalog"
          >
            Catalog
          </button>
          <button
            type="button"
            className="btn gm-dense-link"
            onClick={() => go('fte')}
            aria-label="Open Facility, Tool and Equipment Tracking Panel"
          >
            FTE
          </button>
        </div>
        </div>
      </div>

      {!isStm && !isFrontlineDash ? (
        <div
          id="targetConfigPanel"
          className={`bg-slate-900 border border-blue-500/30 p-4 rounded-lg mb-6 gm-target-panel${targetsOpen ? '' : ' hidden'}`}
        >
          <div className="flex justify-between items-center mb-4 gm-target-panel__head">
            <h4 className="text-md font-bold text-orange-400">
              ⚙️ Set Branch Gross Sales Targets for {salesTargets.monthLabel || 'August 2026'}
            </h4>
            <button
              type="button"
              onClick={() => setTargetsOpen(false)}
              className="text-gray-400 hover:text-white gm-target-panel__close"
              aria-label="Close target panel"
            >
              ✕
            </button>
          </div>
          <form
            id="targetForm"
            method="post"
            action="/gm/branch-targets"
            className="grid grid-cols-1 md:grid-cols-4 gap-4 gm-target-form"
          >
            <input type="hidden" name="date" value={dateValue} />
            <input type="hidden" name="duration" value={activeDuration} />
            {BRANCH_TARGET_NAMES.map((branchName) => (
              <div key={branchName}>
                <label className="block text-xs font-medium text-gray-300">{branchName} Target (₱)</label>
                <input
                  type="number"
                  name={branchName}
                  min={0}
                  step={1000}
                  defaultValue={Number((salesTargets.branches && salesTargets.branches[branchName]) || 0)}
                  className="w-full bg-slate-800 border border-gray-600 rounded p-1.5 text-white text-sm"
                />
              </div>
            ))}
            <div className="md:col-span-4 flex justify-end mt-2 gm-target-form__actions">
              <button
                type="submit"
                className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold rounded shadow"
              >
                💾 Save & Recalculate Dashboard
              </button>
            </div>
          </form>
        </div>
      ) : null}

      <div className="gm-analytics__grid">
        <div className="gm-analytics__kpis">
          {kpis.map((card, index) => (
            <article
              className={`gm-kpi-card gm-kpi-card--stack${index === 0 ? ' gm-kpi-card--hero' : ''}`}
              key={card.id}
              id={
                card.id === 'revenue'
                  ? 'gm-revenue-card'
                  : card.id === 'cumulative'
                    ? 'gm-cumulative-card'
                    : card.id === 'pending'
                      ? 'gm-pending-card'
                      : 'gm-ticket-card'
              }
            >
              <p className="gm-kpi-label">{card.label}</p>
              <h2 className="gm-kpi-value">{card.value}</h2>
              {card.delta ? <span className="gm-kpi-delta">{card.delta}</span> : null}
              {card.id === 'pending' ? (
                <div className="gm-kpi-spark" id="gm-pending-spark" aria-hidden="true">
                  {sparkHeights.map((height, sparkIndex) => (
                    <i key={`spark-${sparkIndex}`} style={{ height: `${height}%` }} />
                  ))}
                </div>
              ) : null}
            </article>
          ))}
        </div>

        <article className="dashboard-card gm-panel gm-analytics__card gm-analytics__ratio">
          <div className="dashboard-card__header gm-panel-header">Target Pacing Mix</div>
          <div className="gm-donut-wrap">
            <div
              className="gm-donut"
              id="gm-pacing-donut"
              style={
                {
                  '--seg-a': segA,
                  '--seg-b': segB,
                  '--seg-c': segC,
                } as React.CSSProperties
              }
            >
              <div className="gm-donut__center">
                <strong id="gm-pacing-value">{avgPacing.toFixed(1)}%</strong>
                <span>Avg pacing</span>
              </div>
            </div>
          </div>
        </article>

        <article className="dashboard-card gm-panel gm-analytics__card gm-analytics__perf">
          <div className="dashboard-card__header gm-panel-header">Branch Revenue Performance</div>
          <div className="gm-perf-chart" id="gm-perf-chart">
            {matrixRows.map((row) => {
              const revenue = Number(row.liveAccumulatedRevenue || 0);
              const barHeight = revenue > 0 ? Math.max(10, Math.round((revenue / maxRevenue) * 100)) : 4;
              return (
                <div className="gm-perf-col" key={row.branch} title={`${row.branch} ${formatPeso(revenue)}`}>
                  <div className="gm-perf-col__value">
                    {`P ${Math.round(revenue).toLocaleString('en-PH')}`}
                  </div>
                  <div className="gm-perf-col__track">
                    <div className="gm-perf-col__bar" style={{ height: `${barHeight}%` }} />
                  </div>
                  <div className="gm-perf-col__name">{row.branch}</div>
                </div>
              );
            })}
          </div>
        </article>

        <article className="dashboard-card gm-panel gm-matrix-panel gm-analytics__card gm-analytics__matrix">
          <div className="dashboard-card__header gm-panel-header">Multi-Branch Data Matrix</div>
          <div className="gm-matrix-wrap">
            <table className="list gm-table gm-matrix-table">
              <thead>
                <tr>
                  <th>Branch Name</th>
                  <th>Open Work Orders</th>
                  <th>Live Accumulated Revenue</th>
                  <th>Target Pacing %</th>
                  <th>Labor Gross Margin %</th>
                  <th>Parts Gross Margin %</th>
                  <th>Status Warning</th>
                </tr>
              </thead>
              <tbody id="gm-matrix-body">
                {matrixRows.map((row) => {
                  const openOrders = Number(row.openWorkOrders || 0);
                  const pacing = Number(row.targetPacingPct || 0);
                  const laborGm = Number(row.laborGrossMarginPct || 0);
                  const partsGm = Number(row.partsGrossMarginPct || 0);
                  return (
                    <tr key={row.branch}>
                      <td>{row.branch}</td>
                      <td style={openWorkOrdersCellStyle(openOrders)}>{openOrders}</td>
                      <td>{formatPeso(row.liveAccumulatedRevenue)}</td>
                      <td style={targetPacingCellStyle(pacing)}>
                        <span style={pacingCapsuleStyle}>{pacing.toFixed(1)}%</span>
                      </td>
                      <td style={marginDensityCellStyle(laborGm)}>{laborGm.toFixed(1)}%</td>
                      <td style={marginDensityCellStyle(partsGm)}>{partsGm.toFixed(1)}%</td>
                      <td>
                        <span className={`gm-status-flag gm-status-flag--${row.statusWarningCode}`}>
                          {row.statusWarning}
                        </span>
                      </td>
                    </tr>
                  );
                })}
                {matrixRows.length ? (
                  <tr className="gm-matrix-row--total">
                    <td>Total</td>
                    <td>{matrixTotals.openWorkOrders}</td>
                    <td>{formatPeso(matrixTotals.liveAccumulatedRevenue)}</td>
                    <td>{Number(matrixTotals.targetPacingPct).toFixed(1)}%</td>
                    <td>{Number(matrixTotals.laborGrossMarginPct).toFixed(1)}%</td>
                    <td>{Number(matrixTotals.partsGrossMarginPct).toFixed(1)}%</td>
                    <td>
                      <span className="gm-status-flag gm-status-flag--ok">TOTAL</span>
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </article>

        <article className="dashboard-card gm-panel gm-analytics__card gm-analytics__status">
          <div className="dashboard-card__header gm-panel-header">Network Health</div>
          <div className="gm-donut-wrap" style={{ minHeight: 160 }}>
            <div
              className="gm-donut"
              style={
                {
                  '--seg-a': clampPct((statusCounts.ok / branchCount) * 100),
                  '--seg-b': clampPct(((statusCounts.ok + statusCounts.watch) / branchCount) * 100),
                  '--seg-c': 100,
                  width: 'min(160px, 64%)',
                } as React.CSSProperties
              }
            >
              <div className="gm-donut__center">
                <strong>+{statusCounts.ok}</strong>
                <span>Branches OK</span>
              </div>
            </div>
          </div>
          <div className="gm-status-stats">
            <div>
              <span>OK</span>
              <strong>{statusCounts.ok}</strong>
            </div>
            <div>
              <span>Watch</span>
              <strong>{statusCounts.watch}</strong>
            </div>
            <div>
              <span>Alert</span>
              <strong>{statusCounts.alert}</strong>
            </div>
            <div>
              <span>Open work orders</span>
              <strong>{matrixTotals.openWorkOrders}</strong>
            </div>
          </div>
        </article>
      </div>
    </section>
  );
}
