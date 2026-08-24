import React, { useEffect, useMemo, useState } from 'react';
import './FteDashboard.css';
import {
  FTE_MOCK_CALIBRATION,
  FTE_MOCK_CRIB,
  FTE_MOCK_EMERGENCY,
  FTE_MOCK_EXPENSES,
  FTE_MOCK_PM,
  FTE_MOCK_SAFETY,
  FTE_MOCK_SUMMARY,
  FTE_MOCK_TRANSACTIONS,
} from './fteMockData';
import {
  computeLaborPrice,
  computeTransactionTotal,
  DEFAULT_INHOUSE_LABOR_RATE,
  isInHouseService,
  SERVICE_RENDERED_BY_OPTIONS,
  type FteDashboardProps,
  type FteTransaction,
  type ServiceRenderedBy,
} from './fteTypes';

export type {
  CribAction,
  FteDashboardProps,
  FteStatus,
  FteTransaction,
  FteTransactionRecord,
  SafetyResult,
  ServiceRenderedBy,
} from './fteTypes';

export { DEFAULT_INHOUSE_LABOR_RATE, SERVICE_RENDERED_BY_OPTIONS };

/** Exact 20 export / table column keys in display order. */
export const FTE_TRANSACTION_COLUMNS: Array<keyof FteTransaction> = [
  'Transaction_ID',
  'Transaction_Date',
  'Transaction_Time',
  'Branch_Name',
  'Asset_ID',
  'Asset_Name',
  'Asset_Category',
  'Transaction_Type',
  'Description',
  'serviceRenderedBy',
  'laborRate',
  'serviceHours',
  'laborPrice',
  'partsPrice',
  'total',
  'Payment_Method',
  'Vendor_Supplier',
  'Requested_By_User_ID',
  'Approved_By_User_ID',
  'Status',
];

const COLUMN_LABELS: Record<keyof FteTransaction, string> = {
  Transaction_ID: 'Transaction ID',
  Transaction_Date: 'Transaction Date',
  Transaction_Time: 'Transaction Time',
  Branch_Name: 'Branch Name',
  Asset_ID: 'Asset ID',
  Asset_Name: 'Asset Name',
  Asset_Category: 'Asset Category',
  Transaction_Type: 'Transaction Type',
  Description: 'Description',
  serviceRenderedBy: 'Service Rendered By',
  laborRate: 'Labor Rate',
  serviceHours: 'Service Hours',
  laborPrice: 'Labor Price',
  partsPrice: 'Parts Price',
  total: 'Total',
  Payment_Method: 'Payment Method',
  Vendor_Supplier: 'Vendor / Supplier',
  Requested_By_User_ID: 'Requested By',
  Approved_By_User_ID: 'Approved By',
  Status: 'Status',
};

const MONEY_COLUMNS = new Set<keyof FteTransaction>(['laborRate', 'laborPrice', 'partsPrice', 'total']);
const RAW_NUMERIC_COLUMNS = new Set<keyof FteTransaction>([
  'laborRate',
  'serviceHours',
  'laborPrice',
  'partsPrice',
  'total',
]);

/** Local initialized FTE transaction mock database. */
export const FTE_LOCAL_TRANSACTION_DB: FteTransaction[] = FTE_MOCK_TRANSACTIONS;

/** Branch Tracking Workspace shortcut keys (display labels). */
export const FTE_WORKSPACE_BRANCH_TABS = [
  'ALL',
  'CARX2',
  'CARMEN',
  'CEBUCITY',
  'LAPUX2',
  'BOGO',
  'TOLEDO',
  'ITPARK',
] as const;

export type FteWorkspaceBranchTab = (typeof FTE_WORKSPACE_BRANCH_TABS)[number];

const BRANCH_TAB_TO_NAME: Record<Exclude<FteWorkspaceBranchTab, 'ALL'>, string[]> = {
  CARX2: ['Carx2'],
  CARMEN: ['Carmen'],
  CEBUCITY: ['CebuCity'],
  LAPUX2: ['Lapux2'],
  BOGO: ['Bogo'],
  TOLEDO: ['Toledo'],
  ITPARK: ['ITPark'],
};

function normalizeRole(role: string): string {
  return String(role || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z]/g, '');
}

function normalizeBranchKey(value: string): string {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ');
}

function resolveWorkspaceTabFromBranch(branch: string): FteWorkspaceBranchTab {
  const key = normalizeBranchKey(branch).replace(/[^A-Z0-9]/g, '');
  if (key === 'ALL' || !key) return 'ALL';
  if (key === 'CARX2' || key === 'CAR2' || key === 'CARCAR') return 'CARX2';
  if (key === 'CARMEN') return 'CARMEN';
  if (key === 'CEBUCITY' || key === 'CEBU') return 'CEBUCITY';
  if (key === 'LAPUX2' || key === 'LAPU2' || key === 'LAPULAPU') return 'LAPUX2';
  if (key === 'BOGO') return 'BOGO';
  if (key === 'TOLEDO') return 'TOLEDO';
  if (key === 'ITPARK') return 'ITPARK';
  return 'ALL';
}

function branchMatchesTab(branchName: string, tab: FteWorkspaceBranchTab): boolean {
  if (tab === 'ALL') return true;
  const aliases = BRANCH_TAB_TO_NAME[tab] || [];
  const key = normalizeBranchKey(branchName);
  return aliases.some((alias) => normalizeBranchKey(alias) === key);
}

function countStatusForScope(rows: FteTransaction[], tab: FteWorkspaceBranchTab) {
  const scoped = tab === 'ALL' ? rows : rows.filter((row) => branchMatchesTab(row.Branch_Name, tab));
  let pending = 0;
  let posted = 0;
  scoped.forEach((row) => {
    const status = String(row.Status || '').trim().toLowerCase();
    if (status === 'pending approval') pending += 1;
    else if (status === 'posted' || status === 'completed') posted += 1;
  });
  return { pending, posted, total: scoped.length };
}

function isFteOpsRole(role: string): boolean {
  const key = normalizeRole(role);
  return (
    key === 'SA' ||
    key === 'SR' ||
    key === 'SSR' ||
    key === 'SERVICEADVISOR' ||
    key === 'SERVICEREPRESENTATIVE' ||
    key === 'SERVICERECEPTIONIST' ||
    key === 'SENIORSERVICERECEPTIONIST' ||
    key === 'STM' ||
    key === 'SERVICETECHNICALMANAGER' ||
    key === 'GM' ||
    key === 'GENERALMANAGER'
  );
}

/** SA / SR / SSR — frontline ops: Log FTE + branch ledger only (no manager analytics). */
function isFrontlineOpsRole(role: string): boolean {
  const key = normalizeRole(role);
  return (
    key === 'SA' ||
    key === 'SR' ||
    key === 'SSR' ||
    key === 'SERVICEADVISOR' ||
    key === 'SERVICEREPRESENTATIVE' ||
    key === 'SERVICERECEPTIONIST' ||
    key === 'SENIORSERVICERECEPTIONIST'
  );
}

function isBranchScopedRole(role: string): boolean {
  const key = normalizeRole(role);
  return (
    key === 'SA' ||
    key === 'SR' ||
    key === 'SSR' ||
    key === 'SERVICEADVISOR' ||
    key === 'SERVICEREPRESENTATIVE' ||
    key === 'SERVICERECEPTIONIST' ||
    key === 'SENIORSERVICERECEPTIONIST' ||
    key === 'STM' ||
    key === 'SERVICETECHNICALMANAGER'
  );
}

function resolveCanonicalBranchName(branch: string, catalog: string[]): string {
  const key = normalizeBranchKey(branch);
  if (!key || key === 'ALL') return '';
  const direct = catalog.find((name) => normalizeBranchKey(name) === key);
  if (direct) return direct;
  const tab = resolveWorkspaceTabFromBranch(branch);
  if (tab !== 'ALL') {
    const aliases = BRANCH_TAB_TO_NAME[tab] || [];
    const fromCatalog = catalog.find((name) =>
      aliases.some((alias) => normalizeBranchKey(alias) === normalizeBranchKey(name))
    );
    if (fromCatalog) return fromCatalog;
    return aliases[0] || String(branch || '').trim();
  }
  return String(branch || '').trim();
}

function branchMatchesAssigned(branchName: string, assigned: string): boolean {
  if (!assigned) return false;
  return normalizeBranchKey(branchName) === normalizeBranchKey(assigned);
}

type IssueFormState = {
  Branch_Name: string;
  Asset_ID: string;
  Asset_Name: string;
  Asset_Category: string;
  Transaction_Type: string;
  Description: string;
  serviceRenderedBy: ServiceRenderedBy;
  laborRate: number;
  serviceHours: number;
  /** Manual flat labor price used when service is external. */
  laborPrice: number;
  partsPrice: number;
  Payment_Method: string;
  Vendor_Supplier: string;
  Requested_By_User_ID: string;
  Approved_By_User_ID: string;
  Status: string;
};

function createEmptyForm(defaultBranch = ''): IssueFormState {
  return {
    Branch_Name: defaultBranch,
    Asset_ID: '',
    Asset_Name: '',
    Asset_Category: 'Shop Equipment',
    Transaction_Type: 'Repair',
    Description: '',
    serviceRenderedBy: 'In-House Mechanic',
    laborRate: DEFAULT_INHOUSE_LABOR_RATE,
    serviceHours: 1,
    laborPrice: DEFAULT_INHOUSE_LABOR_RATE * 1,
    partsPrice: 0,
    Payment_Method: 'Company Card',
    Vendor_Supplier: '',
    Requested_By_User_ID: 'USR-STM-014',
    Approved_By_User_ID: 'USR-GM-001',
    Status: 'Pending Approval',
  };
}

function formatPeso(value: number): string {
  const amount = Number.isFinite(value) ? value : 0;
  return `₱ ${amount.toLocaleString('en-PH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function csvEscape(value: string | number): string {
  const text = String(value ?? '');
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function buildTransactionsCsv(rows: FteTransaction[]): string {
  const header = FTE_TRANSACTION_COLUMNS.join(',');
  const body = rows
    .map((row) =>
      FTE_TRANSACTION_COLUMNS.map((key) => {
        const value = row[key];
        if (RAW_NUMERIC_COLUMNS.has(key)) {
          const num = Number(value);
          return csvEscape(Number.isFinite(num) ? num : 0);
        }
        return csvEscape(value);
      }).join(',')
    )
    .join('\r\n');
  return `\uFEFF${header}\r\n${body}\r\n`;
}

function downloadTransactionsCsv(rows: FteTransaction[]) {
  const csv = buildTransactionsCsv(rows);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `FTE_Transaction_Ledger_2026-08-13.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function statusTone(status: string): string {
  const key = String(status || '').toLowerCase();
  if (key.includes('pending')) return 'out';
  if (key.includes('void') || key.includes('reject')) return 'fail';
  return 'pass';
}

/** Soft row tint classes by Status (Completed / In-Progress keep default). */
function ledgerRowClassName(status: string): string {
  const key = String(status || '').trim().toLowerCase();
  if (key === 'pending approval') {
    return 'fte-ledger-row fte-ledger-row--pending bg-amber-50 hover:bg-amber-100/80 transition-colors';
  }
  if (key === 'rejected') {
    return 'fte-ledger-row fte-ledger-row--rejected bg-red-50/50 hover:bg-red-100/50 transition-colors';
  }
  return 'fte-ledger-row fte-ledger-row--default transition-colors';
}

function nextTransactionId(existing: FteTransaction[]): string {
  const seq = String(existing.length + 1).padStart(4, '0');
  return `FTE-TXN-20260813-${seq}`;
}

/**
 * Facility, Tool & Equipment (FTE) Tracking Panel
 * 20-column ledger + Service Rendered By calculation engine.
 */
export default function FteDashboard({
  opexMtd = FTE_MOCK_SUMMARY.opexMtd,
  criticalUptimePct = FTE_MOCK_SUMMARY.criticalUptimePct,
  openWorkOrders = FTE_MOCK_SUMMARY.openWorkOrders,
  upcomingPms7Days = FTE_MOCK_SUMMARY.upcomingPms7Days,
  emergencyOrders = FTE_MOCK_EMERGENCY,
  scheduledPm = FTE_MOCK_PM,
  recentExpenses = FTE_MOCK_EXPENSES,
  cribTracker = FTE_MOCK_CRIB,
  safetyChecklist = FTE_MOCK_SAFETY,
  calibrationAlerts = FTE_MOCK_CALIBRATION,
  transactions: initialTransactions = FTE_LOCAL_TRANSACTION_DB,
  onLogIssue,
  onBack,
  branches = [
    'Carx2',
    'Carmen',
    'CebuCity',
    'Lapux2',
    'Bogo',
    'Toledo',
    'ITPark',
  ],
  // Testing defaults — SA/SR scoped to CebuCity; pass currentUserRole="GM" for global view.
  currentUserRole = 'SA',
  currentUserBranch = 'CebuCity',
  initialModalOpen = false,
}: FteDashboardProps) {
  const roleKey = normalizeRole(currentUserRole);
  const canAccessFteOps = isFteOpsRole(currentUserRole);
  const isGmRole = roleKey === 'GM' || roleKey === 'GENERALMANAGER';
  const isFrontlineRole = isFrontlineOpsRole(currentUserRole);
  /** Only GM may Approve; STM/SA/SR retain full log/edit/save privileges. */
  const canApproveTransactions = isGmRole;
  const isScopedRole = isBranchScopedRole(currentUserRole);
  const forcedWorkspaceTab = resolveWorkspaceTabFromBranch(currentUserBranch);
  const assignedBranchName = useMemo(
    () => resolveCanonicalBranchName(currentUserBranch, branches),
    [branches, currentUserBranch]
  );
  const branchLocked = isFrontlineRole || (isScopedRole && Boolean(assignedBranchName));
  const formBranchOptions = useMemo(() => {
    if (branchLocked && assignedBranchName) return [assignedBranchName];
    return branches;
  }, [assignedBranchName, branchLocked, branches]);

  const [selectedBranch, setSelectedBranch] = useState(() =>
    branchLocked && assignedBranchName ? assignedBranchName : ''
  );
  const [activeBranchTab, setActiveBranchTab] = useState<FteWorkspaceBranchTab>(() =>
    isScopedRole ? forcedWorkspaceTab : 'ALL'
  );
  /** Optional status chip filter preserved across branch tab changes. */
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'Pending Approval' | 'Posted'>('ALL');
  const [ledger, setLedger] = useState<FteTransaction[]>(() => [...initialTransactions]);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<IssueFormState>(() =>
    createEmptyForm(branchLocked ? assignedBranchName : '')
  );
  /** When set, modal is reviewing an existing Pending Approval ledger row. */
  const [editingTransactionId, setEditingTransactionId] = useState<string | null>(null);

  const inHouseLocked = isInHouseService(form.serviceRenderedBy);
  const isPendingApprovalReview =
    Boolean(editingTransactionId) &&
    String(form.Status || '').trim().toLowerCase() === 'pending approval';

  const roleVisibleLedger = useMemo(() => {
    if (!canAccessFteOps) return [];
    if (isGmRole) return ledger;
    if (assignedBranchName) {
      return ledger.filter((row) => branchMatchesAssigned(row.Branch_Name, assignedBranchName));
    }
    return ledger.filter((row) => branchMatchesTab(row.Branch_Name, forcedWorkspaceTab));
  }, [assignedBranchName, canAccessFteOps, forcedWorkspaceTab, isGmRole, ledger]);

  const workspaceTabs = useMemo(() => {
    if (isGmRole) return [...FTE_WORKSPACE_BRANCH_TABS];
    return FTE_WORKSPACE_BRANCH_TABS.filter((tab) => tab === forcedWorkspaceTab);
  }, [forcedWorkspaceTab, isGmRole]);

  const branchSummaries = useMemo(() => {
    return workspaceTabs.map((tab) => ({
      tab,
      ...countStatusForScope(roleVisibleLedger, tab),
    }));
  }, [roleVisibleLedger, workspaceTabs]);

  const derivedLaborPrice = useMemo(() => {
    if (inHouseLocked) {
      return computeLaborPrice(form.laborRate, form.serviceHours);
    }
    return Number.isFinite(form.laborPrice) ? form.laborPrice : 0;
  }, [form.laborPrice, form.laborRate, form.serviceHours, inHouseLocked]);

  const totalAmount = useMemo(
    () => computeTransactionTotal(derivedLaborPrice, form.partsPrice),
    [derivedLaborPrice, form.partsPrice]
  );

  const effectiveBranchTab: FteWorkspaceBranchTab = isScopedRole
    ? forcedWorkspaceTab
    : activeBranchTab;

  const ledgerRows = useMemo(() => {
    let rows = roleVisibleLedger;
    if (effectiveBranchTab !== 'ALL') {
      rows = rows.filter((row) => branchMatchesTab(row.Branch_Name, effectiveBranchTab));
    } else if (selectedBranch) {
      rows = rows.filter((row) => row.Branch_Name === selectedBranch);
    }
    if (statusFilter === 'Pending Approval') {
      rows = rows.filter(
        (row) => String(row.Status || '').trim().toLowerCase() === 'pending approval'
      );
    } else if (statusFilter === 'Posted') {
      rows = rows.filter((row) => {
        const status = String(row.Status || '').trim().toLowerCase();
        return status === 'posted' || status === 'completed';
      });
    }
    return rows;
  }, [effectiveBranchTab, roleVisibleLedger, selectedBranch, statusFilter]);

  function selectWorkspaceBranch(tab: FteWorkspaceBranchTab) {
    if (isScopedRole && tab !== forcedWorkspaceTab) return;
    setActiveBranchTab(tab);
    if (tab === 'ALL') {
      setSelectedBranch('');
      return;
    }
    const canonical = (BRANCH_TAB_TO_NAME[tab] || [])[0] || '';
    setSelectedBranch(canonical);
  }

  function canMutateRow(row: FteTransaction): boolean {
    if (!canAccessFteOps) return false;
    if (isGmRole) return true;
    if (assignedBranchName) {
      return branchMatchesAssigned(row.Branch_Name, assignedBranchName);
    }
    return branchMatchesTab(row.Branch_Name, forcedWorkspaceTab);
  }

  const summaryCards = useMemo(
    () => [
      { label: 'FTE OPEX MTD', value: formatPeso(opexMtd) },
      { label: 'CRITICAL EQUIPMENT UPTIME', value: `${Number(criticalUptimePct).toFixed(1)}%` },
      { label: 'OPEN WORK ORDERS', value: String(openWorkOrders) },
      { label: 'UPCOMING PMS (7 DAYS)', value: String(upcomingPms7Days) },
    ],
    [opexMtd, criticalUptimePct, openWorkOrders, upcomingPms7Days]
  );

  function cribActionMeta(action: string): { label: string; tone: 'out' | 'in' } {
    const key = String(action || '').trim().toLowerCase();
    if (key === 'check-out' || key === 'checked out' || key === 'out') {
      return { label: 'Checked Out', tone: 'out' };
    }
    return { label: 'Returned', tone: 'in' };
  }

  function openIssueModal() {
    if (!canAccessFteOps) return;
    if (onLogIssue) onLogIssue();
    setEditingTransactionId(null);
    const defaultBranch =
      (branchLocked && assignedBranchName) ||
      selectedBranch ||
      (effectiveBranchTab !== 'ALL' ? (BRANCH_TAB_TO_NAME[effectiveBranchTab] || [])[0] : '') ||
      branches[0] ||
      '';
    setForm(createEmptyForm(defaultBranch));
    setModalOpen(true);
  }

  useEffect(() => {
    if (!initialModalOpen || !canAccessFteOps) return;
    openIssueModal();
    // Mount-only deep-link from STM/GM dashboard "+ LOG FTE ISSUE".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialModalOpen, canAccessFteOps]);

  function openPendingApprovalModal(row: FteTransaction) {
    if (String(row.Status || '').trim().toLowerCase() !== 'pending approval') return;
    if (!canMutateRow(row)) {
      window.alert('You can only review pending logs for your assigned branch.');
      return;
    }
    setEditingTransactionId(row.Transaction_ID);
    setForm({
      Branch_Name: row.Branch_Name,
      Asset_ID: row.Asset_ID,
      Asset_Name: row.Asset_Name,
      Asset_Category: row.Asset_Category,
      Transaction_Type: row.Transaction_Type,
      Description: row.Description,
      serviceRenderedBy: row.serviceRenderedBy,
      laborRate: row.laborRate,
      serviceHours: row.serviceHours,
      laborPrice: row.laborPrice,
      partsPrice: row.partsPrice,
      Payment_Method: row.Payment_Method,
      Vendor_Supplier: row.Vendor_Supplier,
      Requested_By_User_ID: row.Requested_By_User_ID,
      Approved_By_User_ID: row.Approved_By_User_ID,
      Status: row.Status,
    });
    setModalOpen(true);
  }

  function closeIssueModal() {
    setModalOpen(false);
    setEditingTransactionId(null);
  }

  function handleApprove() {
    if (!canApproveTransactions) return;
    if (!editingTransactionId) return;
    const target = ledger.find((row) => row.Transaction_ID === editingTransactionId);
    if (!target || !canMutateRow(target)) {
      window.alert('You can only approve logs for your assigned branch.');
      return;
    }
    setLedger((prev) =>
      prev.map((row) =>
        row.Transaction_ID === editingTransactionId
          ? { ...row, Status: 'Posted' }
          : row
      )
    );
    setModalOpen(false);
    setEditingTransactionId(null);
  }

  function patchForm<K extends keyof IssueFormState>(key: K, value: IssueFormState[K]) {
    setForm((prev) => {
      const next: IssueFormState = { ...prev, [key]: value };

      if (key === 'serviceRenderedBy') {
        const renderedBy = value as ServiceRenderedBy;
        if (isInHouseService(renderedBy)) {
          next.laborRate = DEFAULT_INHOUSE_LABOR_RATE;
          next.laborPrice = computeLaborPrice(DEFAULT_INHOUSE_LABOR_RATE, next.serviceHours);
        } else {
          // Third-Party Provider / Manufacturer Tech — unlock custom invoice labor price
          next.laborRate = 0;
          next.laborPrice = 0;
        }
        return next;
      }

      if (key === 'serviceHours' || key === 'laborRate') {
        if (isInHouseService(next.serviceRenderedBy)) {
          next.laborRate = DEFAULT_INHOUSE_LABOR_RATE;
          next.laborPrice = computeLaborPrice(next.laborRate, next.serviceHours);
        }
      }

      return next;
    });
  }

  function handleSubmitIssue(event: React.FormEvent) {
    event.preventDefault();
    const lockedBranch =
      branchLocked && assignedBranchName ? assignedBranchName : form.Branch_Name.trim();
    if (!lockedBranch) {
      window.alert('Please select a Branch before saving.');
      return;
    }
    if (
      isScopedRole &&
      assignedBranchName &&
      !branchMatchesAssigned(lockedBranch, assignedBranchName)
    ) {
      window.alert(`You can only log FTE issues for your assigned branch (${assignedBranchName}).`);
      return;
    }

    const laborPrice = inHouseLocked
      ? computeLaborPrice(DEFAULT_INHOUSE_LABOR_RATE, form.serviceHours)
      : Number(form.laborPrice) || 0;
    const laborRate = inHouseLocked ? DEFAULT_INHOUSE_LABOR_RATE : 0;
    const partsPrice = Number(form.partsPrice) || 0;
    const total = computeTransactionTotal(laborPrice, partsPrice);

    const sharedFields = {
      Branch_Name: lockedBranch,
      Asset_ID: form.Asset_ID.trim() || 'AST-NEW',
      Asset_Name: form.Asset_Name.trim(),
      Asset_Category: form.Asset_Category,
      Transaction_Type: form.Transaction_Type,
      Description: form.Description.trim() || 'FTE issue logged',
      serviceRenderedBy: form.serviceRenderedBy,
      laborRate,
      serviceHours: Number(form.serviceHours) || 0,
      laborPrice,
      partsPrice,
      total,
      Payment_Method: form.Payment_Method,
      Vendor_Supplier:
        form.Vendor_Supplier.trim() ||
        (inHouseLocked ? form.serviceRenderedBy : 'External Invoice Vendor'),
      Requested_By_User_ID: form.Requested_By_User_ID.trim() || 'USR-STM-014',
      Approved_By_User_ID: form.Approved_By_User_ID.trim() || 'USR-GM-001',
      Status: form.Status,
    };

    if (editingTransactionId) {
      setLedger((prev) =>
        prev.map((row) =>
          row.Transaction_ID === editingTransactionId
            ? {
                ...row,
                ...sharedFields,
              }
            : row
        )
      );
    } else {
      const record: FteTransaction = {
        Transaction_ID: nextTransactionId(ledger),
        Transaction_Date: '2026-08-13',
        Transaction_Time: new Date().toTimeString().slice(0, 8),
        ...sharedFields,
      };
      setLedger((prev) => [record, ...prev]);
    }

    setModalOpen(false);
    setEditingTransactionId(null);
  }

  function handleExportCsv() {
    downloadTransactionsCsv(ledgerRows.length ? ledgerRows : ledger);
  }

  const backLabel = isFrontlineRole
    ? '← Dashboard'
    : isScopedRole
      ? '← STM Dashboard'
      : '← GM Dashboard';

  return (
    <section className={`fte-shell gm-shell${isFrontlineRole ? ' fte-shell--frontline' : ''}`}>
      <div className="fte-header-row">
        <div className="dashboard-title gm-title role-dashboard-title">
          <span>Facility, Tool &amp; Equipment</span>{' '}
          <span className="role-dashboard-title__suffix">Tracking Panel</span>
        </div>
        <div className="fte-header-actions">
          {onBack ? (
            <button type="button" className="btn gm-dense-link" onClick={onBack}>
              {backLabel}
            </button>
          ) : null}
          {branchLocked && assignedBranchName ? (
            <span className="fte-branch-locked-badge" title="Assigned branch (locked)">
              Branch: <strong>{assignedBranchName}</strong>
            </span>
          ) : (
            <label className="fte-branch-select" htmlFor="fte-branch-filter">
              <span className="fte-branch-select__label">Select Branch</span>
              <select
                id="fte-branch-filter"
                name="branch"
                aria-label="Select Branch"
                value={selectedBranch}
                onChange={(event) => setSelectedBranch(event.target.value)}
              >
                <option value="">Select Branch</option>
                {branches.map((branchName) => (
                  <option key={branchName} value={branchName}>
                    {branchName}
                  </option>
                ))}
              </select>
            </label>
          )}
          {!isFrontlineRole ? (
            <button type="button" className="btn fte-export-btn" onClick={handleExportCsv}>
              Export CSV
            </button>
          ) : null}
          <button type="button" className="btn fte-log-btn" onClick={openIssueModal}>
            + Log FTE Issue
          </button>
        </div>
      </div>

      {!isFrontlineRole ? (
        <>
          <div className="gm-kpi-grid gm-kpi-grid--tier1 fte-kpi-grid">
            {summaryCards.map((card) => (
              <article className="gm-kpi-card" key={card.label}>
                <p className="gm-kpi-label">{card.label}</p>
                <h2 className="gm-kpi-value">{card.value}</h2>
              </article>
            ))}
          </div>

          <div className="fte-body-grid">
            <div className="fte-col">
              <article className="dashboard-card gm-panel fte-panel">
                <div className="dashboard-card__header gm-panel-header">Emergency Equipment Work Orders</div>
                <div className="fte-scroll">
                  <table className="list gm-table fte-table">
                    <thead>
                      <tr>
                        <th>WO #</th>
                        <th>Equipment</th>
                        <th>Branch</th>
                        <th>Priority</th>
                        <th>Status</th>
                        <th>Age</th>
                      </tr>
                    </thead>
                    <tbody>
                      {emergencyOrders.map((row) => (
                        <tr key={row.id}>
                          <td>{row.id}</td>
                          <td>{row.equipment}</td>
                          <td>{row.branch}</td>
                          <td>
                            <span className={`fte-pill fte-pill--${row.priority.toLowerCase()}`}>
                              {row.priority}
                            </span>
                          </td>
                          <td>{row.status}</td>
                          <td>{row.ageHours}h</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </article>

              <article className="dashboard-card gm-panel fte-panel">
                <div className="dashboard-card__header gm-panel-header">Scheduled PM</div>
                <div className="fte-scroll fte-list-feed">
                  {scheduledPm.map((item) => (
                    <div className="fte-feed-item" key={item.id}>
                      <strong>{item.asset}</strong>
                      <span>{item.branch}</span>
                      <em>{item.dueDate}</em>
                      <small>{item.technician}</small>
                    </div>
                  ))}
                </div>
              </article>
            </div>

            <div className="fte-col">
              <article className="dashboard-card gm-panel fte-panel">
                <div className="dashboard-card__header gm-panel-header">Recent FTE Expenses</div>
                <div className="fte-scroll">
                  <table className="list gm-table fte-table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Description</th>
                        <th>Category</th>
                        <th>Branch</th>
                        <th>Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recentExpenses.map((row) => (
                        <tr key={row.id}>
                          <td>{row.date}</td>
                          <td>{row.description}</td>
                          <td>{row.category}</td>
                          <td>{row.branch}</td>
                          <td className="fte-money">{formatPeso(row.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </article>

              <article className="dashboard-card gm-panel fte-panel">
                <div className="dashboard-card__header gm-panel-header">Tool Crib Check-In / Out</div>
                <div className="fte-scroll">
                  <table className="list gm-table fte-table">
                    <thead>
                      <tr>
                        <th>Time</th>
                        <th>Tool</th>
                        <th>Assignee</th>
                        <th>Branch</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cribTracker.map((row) => {
                        const crib = cribActionMeta(row.action);
                        return (
                          <tr key={row.id}>
                            <td>{row.at}</td>
                            <td>{row.tool}</td>
                            <td>{row.assignee}</td>
                            <td>{row.branch}</td>
                            <td>
                              <span className={`fte-pill fte-pill--${crib.tone}`}>{crib.label}</span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </article>
            </div>

            <div className="fte-col">
              <article className="dashboard-card gm-panel fte-panel">
                <div className="dashboard-card__header gm-panel-header">Daily Shop Safety Checklist</div>
                <div className="fte-scroll fte-list-feed">
                  {safetyChecklist.map((row) => (
                    <div className="fte-feed-item" key={`${row.branch}-${row.date}`}>
                      <strong>{row.branch}</strong>
                      <span>{row.date}</span>
                      <span className={`fte-pill fte-pill--${row.result.toLowerCase()}`}>{row.result}</span>
                      <small>{row.completedBy}</small>
                    </div>
                  ))}
                </div>
              </article>

              <article className="dashboard-card gm-panel fte-panel">
                <div className="dashboard-card__header gm-panel-header">Calibration Due Alerts</div>
                <div className="fte-scroll fte-list-feed">
                  {calibrationAlerts.map((row) => (
                    <div className="fte-feed-item" key={row.serial}>
                      <strong>{row.asset}</strong>
                      <span>{row.branch}</span>
                      <em className={row.dueInDays <= 3 ? 'fte-due-urgent' : ''}>
                        {row.dueInDays} day{row.dueInDays === 1 ? '' : 's'}
                      </em>
                      <small>{row.serial}</small>
                    </div>
                  ))}
                </div>
              </article>
            </div>
          </div>
        </>
      ) : null}

      {!canAccessFteOps ? (
        <article className="dashboard-card gm-panel fte-panel fte-access-denied" role="alert">
          <div className="dashboard-card__header gm-panel-header">Access Denied</div>
          <p>
            Branch Tracking Workspace and FTE transaction data are restricted to{' '}
            <strong>STM</strong>, <strong>SA</strong>, <strong>SR</strong>, <strong>SSR</strong>, and <strong>GM</strong> roles.
          </p>
          <p className="fte-access-denied__meta">
            Current mock role: <strong>{currentUserRole || '—'}</strong>
          </p>
        </article>
      ) : (
        <>
          {!isFrontlineRole ? (
            <article className="dashboard-card gm-panel fte-panel fte-branch-workspace">
              <div className="dashboard-card__header gm-panel-header fte-ledger-header">
                <span>Branch Tracking Workspace</span>
                <small>
                  Role: {roleKey || '—'}
                  {isScopedRole
                    ? ` · Scoped to ${assignedBranchName || forcedWorkspaceTab}`
                    : ' · Global visibility'}
                </small>
              </div>
              <div className="fte-branch-tabs" role="tablist" aria-label="Branch tracking shortcuts">
                {branchSummaries.map(({ tab, pending, posted }) => {
                  const isActive = effectiveBranchTab === tab;
                  const lockedOut = isScopedRole && tab !== forcedWorkspaceTab;
                  return (
                    <button
                      key={tab}
                      type="button"
                      role="tab"
                      aria-selected={isActive}
                      disabled={lockedOut}
                      className={`fte-branch-tab${isActive ? ' is-active' : ''}`}
                      onClick={() => selectWorkspaceBranch(tab)}
                    >
                      <strong>{tab}</strong>
                      <span>
                        {pending} Pending / {posted} Posted
                      </span>
                    </button>
                  );
                })}
              </div>
              <div className="fte-status-filter-row" role="group" aria-label="Status filter">
                {(['ALL', 'Pending Approval', 'Posted'] as const).map((status) => (
                  <button
                    key={status}
                    type="button"
                    className={`fte-status-filter${statusFilter === status ? ' is-active' : ''}`}
                    onClick={() => setStatusFilter(status)}
                  >
                    {status === 'ALL' ? 'All Statuses' : status}
                  </button>
                ))}
              </div>
            </article>
          ) : null}

          <article className="dashboard-card gm-panel fte-panel fte-ledger-panel">
            <div className="dashboard-card__header gm-panel-header fte-ledger-header">
              <span>FTE Transaction Ledger History</span>
              <small>
                {ledgerRows.length} record{ledgerRows.length === 1 ? '' : 's'} ·{' '}
                {assignedBranchName || effectiveBranchTab}
                {statusFilter !== 'ALL' ? ` · ${statusFilter}` : ''} · 20 columns
                {isFrontlineRole || branchLocked ? ' · Branch-locked' : ''}
              </small>
            </div>
            <div className="fte-ledger-scroll">
              <table className="list gm-table fte-table fte-ledger-table">
                <thead>
                  <tr>
                    {FTE_TRANSACTION_COLUMNS.map((column) => (
                      <th key={column}>{COLUMN_LABELS[column].toUpperCase()}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ledgerRows.length === 0 ? (
                    <tr>
                      <td colSpan={FTE_TRANSACTION_COLUMNS.length} style={{ textAlign: 'center' }}>
                        No FTE transactions for the selected branch.
                      </td>
                    </tr>
                  ) : (
                    ledgerRows.map((row) => (
                      <tr key={row.Transaction_ID} className={ledgerRowClassName(row.Status)}>
                        {FTE_TRANSACTION_COLUMNS.map((column) => {
                          const value = row[column];
                          if (column === 'Status') {
                            const statusText = String(value || '');
                            const isPending = statusText.trim().toLowerCase() === 'pending approval';
                            return (
                              <td key={column}>
                                {isPending && canMutateRow(row) ? (
                                  <button
                                    type="button"
                                    className={`fte-pill fte-pill--${statusTone(statusText)} fte-status-trigger`}
                                    title={
                                      canApproveTransactions
                                        ? 'Review & approve this pending transaction'
                                        : 'Review this pending transaction'
                                    }
                                    onClick={() => openPendingApprovalModal(row)}
                                  >
                                    {statusText}
                                  </button>
                                ) : (
                                  <span className={`fte-pill fte-pill--${statusTone(statusText)}`}>
                                    {statusText}
                                  </span>
                                )}
                              </td>
                            );
                          }
                          if (column === 'serviceHours') {
                            return <td key={column}>{Number(value).toFixed(2)}</td>;
                          }
                          if (MONEY_COLUMNS.has(column)) {
                            return (
                              <td key={column} className="fte-money">
                                {formatPeso(Number(value))}
                              </td>
                            );
                          }
                          if (column === 'Description') {
                            return (
                              <td key={column} title={String(value)}>
                                {value}
                              </td>
                            );
                          }
                          return <td key={column}>{value}</td>;
                        })}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </article>
        </>
      )}

      {modalOpen ? (
        <div className="fte-modal-backdrop is-open" role="presentation" onClick={closeIssueModal}>
          <div
            className="fte-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="fte-issue-modal-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="fte-modal__header">
              <h3 id="fte-issue-modal-title">
                {isPendingApprovalReview ? 'Review Pending FTE Transaction' : 'Log FTE Issue / Transaction'}
              </h3>
              <button type="button" className="btn gm-dense-link" onClick={closeIssueModal}>
                Close
              </button>
            </div>
            <form className="fte-modal__form" onSubmit={handleSubmitIssue}>
              <div className="fte-modal__grid">
                <label>
                  Branch
                  <select
                    required
                    value={form.Branch_Name}
                    onChange={(e) => {
                      if (branchLocked) return;
                      patchForm('Branch_Name', e.target.value);
                    }}
                    disabled={branchLocked}
                    className={branchLocked ? 'fte-modal__readonly' : undefined}
                    aria-readonly={branchLocked || undefined}
                    title={
                      branchLocked
                        ? `Locked to your assigned branch (${assignedBranchName})`
                        : undefined
                    }
                  >
                    {!branchLocked ? <option value="">Select Branch</option> : null}
                    {formBranchOptions.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Transaction Type
                  <select
                    value={form.Transaction_Type}
                    onChange={(e) => patchForm('Transaction_Type', e.target.value)}
                  >
                    <option>Repair</option>
                    <option>Calibration</option>
                    <option>Purchase</option>
                    <option>Preventive Maintenance</option>
                    <option>Tool Replacement</option>
                    <option>Service Contract</option>
                  </select>
                </label>
                <label>
                  Asset ID
                  <input
                    value={form.Asset_ID}
                    onChange={(e) => patchForm('Asset_ID', e.target.value)}
                    placeholder="AST-LFT-003"
                  />
                </label>
                <label>
                  Asset Name
                  <input
                    value={form.Asset_Name}
                    onChange={(e) => patchForm('Asset_Name', e.target.value)}
                    placeholder="2-Post Lift #3"
                  />
                </label>
                <label>
                  Asset Category
                  <input
                    value={form.Asset_Category}
                    onChange={(e) => patchForm('Asset_Category', e.target.value)}
                  />
                </label>
                <label>
                  Service Rendered By
                  <select
                    value={form.serviceRenderedBy}
                    onChange={(e) => patchForm('serviceRenderedBy', e.target.value as ServiceRenderedBy)}
                  >
                    {SERVICE_RENDERED_BY_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Labor Rate (₱/hr)
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={form.laborRate}
                    readOnly={inHouseLocked}
                    className={inHouseLocked ? 'fte-modal__readonly' : undefined}
                    onChange={(e) => patchForm('laborRate', Number(e.target.value))}
                  />
                </label>
                <label>
                  Service Hours
                  <input
                    type="number"
                    min={0}
                    step="0.25"
                    value={form.serviceHours}
                    onChange={(e) => patchForm('serviceHours', Number(e.target.value))}
                  />
                </label>
                <label>
                  Labor Price {inHouseLocked ? '(auto)' : '(invoice)'}
                  {inHouseLocked ? (
                    <input
                      type="text"
                      readOnly
                      value={formatPeso(derivedLaborPrice)}
                      className="fte-modal__readonly"
                    />
                  ) : (
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={form.laborPrice}
                      onChange={(e) => patchForm('laborPrice', Number(e.target.value))}
                      placeholder="Flat invoice labor"
                    />
                  )}
                </label>
                <label>
                  Parts Price (₱)
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={form.partsPrice}
                    onChange={(e) => patchForm('partsPrice', Number(e.target.value))}
                  />
                </label>
                <label>
                  Total (auto)
                  <input type="text" readOnly value={formatPeso(totalAmount)} className="fte-modal__readonly" />
                </label>
                <label>
                  Payment Method
                  <select
                    value={form.Payment_Method}
                    onChange={(e) => patchForm('Payment_Method', e.target.value)}
                  >
                    <option>Company Card</option>
                    <option>Bank Transfer</option>
                    <option>Cash</option>
                    <option>Petty Cash</option>
                  </select>
                </label>
                <label>
                  Vendor / Supplier
                  <input
                    value={form.Vendor_Supplier}
                    onChange={(e) => patchForm('Vendor_Supplier', e.target.value)}
                  />
                </label>
                <label>
                  Requested By User ID
                  <input
                    value={form.Requested_By_User_ID}
                    onChange={(e) => patchForm('Requested_By_User_ID', e.target.value)}
                  />
                </label>
                <label>
                  Approved By User ID
                  <input
                    value={form.Approved_By_User_ID}
                    onChange={(e) => patchForm('Approved_By_User_ID', e.target.value)}
                  />
                </label>
                <label className="fte-modal__full">
                  Description
                  <textarea
                    rows={2}
                    value={form.Description}
                    onChange={(e) => patchForm('Description', e.target.value)}
                    placeholder="Describe the FTE issue or work performed"
                  />
                </label>
              </div>
              <p className="fte-modal__calc-note">
                {inHouseLocked ? (
                  <>
                    In-house engine: <strong>laborPrice = ₱{DEFAULT_INHOUSE_LABOR_RATE} × serviceHours</strong>
                  </>
                ) : (
                  <>
                    External engine: <strong>Labor Rate = 0</strong>; enter flat{' '}
                    <strong>Labor Price</strong> from invoice
                  </>
                )}{' '}
                · <strong>total = laborPrice + partsPrice</strong>
              </p>
              <div className="fte-modal__actions">
                <button type="button" className="btn gm-dense-link" onClick={closeIssueModal}>
                  Cancel
                </button>
                <button type="submit" className="btn fte-log-btn">
                  Save Transaction
                </button>
                {canApproveTransactions && isPendingApprovalReview ? (
                  <button type="button" className="btn fte-approve-btn" onClick={handleApprove}>
                    Approve
                  </button>
                ) : null}
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </section>
  );
}
