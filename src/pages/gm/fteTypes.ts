export type FteStatus = 'Open' | 'In Progress' | 'Scheduled' | 'Closed';
export type SafetyResult = 'Pass' | 'Fail';
export type CribAction = 'Check-Out' | 'Check-In';

/** In-house shop default labor rate (₱ / hour). */
export const DEFAULT_INHOUSE_LABOR_RATE = 350;

export type ServiceRenderedBy =
  | 'In-House Mechanic'
  | 'In-House Electrician'
  | 'Third-Party Provider'
  | 'Manufacturer Tech';

export const SERVICE_RENDERED_BY_OPTIONS: ServiceRenderedBy[] = [
  'In-House Mechanic',
  'In-House Electrician',
  'Third-Party Provider',
  'Manufacturer Tech',
];

/**
 * Complete 20-column FTE transaction ledger schema.
 * Column order: identity → asset → serviceRenderedBy → laborRate → serviceHours → laborPrice → parts → total → payment/status.
 */
export interface FteTransaction {
  Transaction_ID: string;
  Transaction_Date: string;
  Transaction_Time: string;
  Branch_Name: string;
  Asset_ID: string;
  Asset_Name: string;
  Asset_Category: string;
  Transaction_Type: string;
  Description: string;
  serviceRenderedBy: ServiceRenderedBy;
  laborRate: number;
  serviceHours: number;
  laborPrice: number;
  partsPrice: number;
  /** Total = laborPrice + partsPrice */
  total: number;
  Payment_Method: string;
  Vendor_Supplier: string;
  Requested_By_User_ID: string;
  Approved_By_User_ID: string;
  Status: string;
}

/** @deprecated Prefer FteTransaction — kept as alias for existing imports. */
export type FteTransactionRecord = FteTransaction;

export type FteDashboardProps = {
  opexMtd?: number;
  criticalUptimePct?: number;
  openWorkOrders?: number;
  upcomingPms7Days?: number;
  emergencyOrders?: Array<{
    id: string;
    equipment: string;
    branch: string;
    priority: 'Critical' | 'High' | 'Medium';
    status: FteStatus;
    ageHours: number;
  }>;
  scheduledPm?: Array<{
    id: string;
    asset: string;
    branch: string;
    dueDate: string;
    technician: string;
  }>;
  recentExpenses?: Array<{
    id: string;
    date: string;
    description: string;
    category: string;
    branch: string;
    amount: number;
  }>;
  cribTracker?: Array<{
    id: string;
    tool: string;
    assignee: string;
    branch: string;
    action: CribAction;
    at: string;
  }>;
  safetyChecklist?: Array<{
    branch: string;
    date: string;
    result: SafetyResult;
    completedBy: string;
  }>;
  calibrationAlerts?: Array<{
    asset: string;
    branch: string;
    dueInDays: number;
    serial: string;
  }>;
  onLogIssue?: () => void;
  onBack?: () => void;
  branches?: string[];
  transactions?: FteTransaction[];
  /** Mock / session role for RBAC: SA | SR | STM | GM (others denied). */
  currentUserRole?: string;
  /** Assigned branch for SA/SR/STM (e.g. CebuCity). GM ignores this for global view. */
  currentUserBranch?: string;
  /** Open the Log FTE Issue modal on mount (e.g. STM dashboard "+ LOG FTE ISSUE"). */
  initialModalOpen?: boolean;
};

export function isInHouseService(value: ServiceRenderedBy): boolean {
  return value === 'In-House Mechanic' || value === 'In-House Electrician';
}

export function computeLaborPrice(laborRate: number, serviceHours: number): number {
  const rate = Number.isFinite(laborRate) ? laborRate : 0;
  const hours = Number.isFinite(serviceHours) ? serviceHours : 0;
  return Math.round(rate * hours * 100) / 100;
}

export function computeTransactionTotal(laborPrice: number, partsPrice: number): number {
  const labor = Number.isFinite(laborPrice) ? laborPrice : 0;
  const parts = Number.isFinite(partsPrice) ? partsPrice : 0;
  return Math.round((labor + parts) * 100) / 100;
}
