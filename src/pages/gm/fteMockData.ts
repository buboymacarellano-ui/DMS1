import {
  computeLaborPrice,
  computeTransactionTotal,
  DEFAULT_INHOUSE_LABOR_RATE,
  type CribAction,
  type FteDashboardProps,
  type FteStatus,
  type FteTransaction,
  type SafetyResult,
  type ServiceRenderedBy,
} from './fteTypes';

export {
  computeLaborPrice,
  computeTransactionTotal,
  DEFAULT_INHOUSE_LABOR_RATE,
};

/** @deprecated Use DEFAULT_INHOUSE_LABOR_RATE */
export const FTE_IN_HOUSE_LABOR_RATE = DEFAULT_INHOUSE_LABOR_RATE;

export const FTE_MOCK_SUMMARY = {
  opexMtd: 86420.75,
  criticalUptimePct: 97.4,
  openWorkOrders: 4,
  upcomingPms7Days: 4,
} as const;

export const FTE_MOCK_EMERGENCY: NonNullable<FteDashboardProps['emergencyOrders']> = [
  { id: 'FTE-2401', equipment: '2-Post Lift #3', branch: 'Carmen', priority: 'Critical', status: 'Open' as FteStatus, ageHours: 6 },
  { id: 'FTE-2398', equipment: 'Wheel Aligner', branch: 'CebuCity', priority: 'High', status: 'In Progress' as FteStatus, ageHours: 14 },
  { id: 'FTE-2395', equipment: 'Air Compressor', branch: 'Lapux2', priority: 'Critical', status: 'Open' as FteStatus, ageHours: 3 },
  { id: 'FTE-2391', equipment: 'Tire Changer', branch: 'Bogo', priority: 'Medium', status: 'In Progress' as FteStatus, ageHours: 22 },
];

export const FTE_MOCK_PM: NonNullable<FteDashboardProps['scheduledPm']> = [
  { id: 'PM-118', asset: 'Torque Wrench Set A', branch: 'Toledo', dueDate: '2026-08-15', technician: 'R. Santos' },
  { id: 'PM-119', asset: 'Paint Booth Filters', branch: 'ITPark', dueDate: '2026-08-16', technician: 'J. Cruz' },
  { id: 'PM-120', asset: 'Hydraulic Press', branch: 'Carmen', dueDate: '2026-08-17', technician: 'M. Dela Cruz' },
  { id: 'PM-121', asset: 'AC Recovery Unit', branch: 'CebuCity', dueDate: '2026-08-18', technician: 'A. Reyes' },
];

export const FTE_MOCK_EXPENSES: NonNullable<FteDashboardProps['recentExpenses']> = [
  { id: 'EXP-901', date: '2026-08-13', description: 'Lift cable replacement', category: 'Repair', branch: 'Carmen', amount: 13750 },
  { id: 'EXP-900', date: '2026-08-12', description: 'Calibration service fee', category: 'Calibration', branch: 'CebuCity', amount: 4800 },
  { id: 'EXP-898', date: '2026-08-11', description: 'PPE restock (gloves/goggles)', category: 'Safety', branch: 'Bogo', amount: 2650.5 },
  { id: 'EXP-896', date: '2026-08-10', description: 'Compressor oil & filters', category: 'Consumable', branch: 'Lapux2', amount: 3120 },
];

export const FTE_MOCK_CRIB: NonNullable<FteDashboardProps['cribTracker']> = [
  { id: 'CRB-441', tool: 'Impact Oil Gun #12', assignee: 'K. Lim', branch: 'Carmen', action: 'Check-Out' as CribAction, at: '08:14' },
  { id: 'CRB-440', tool: 'Scan Tool Elite', assignee: 'R. Santos', branch: 'CebuCity', action: 'Check-In' as CribAction, at: '09:02' },
  { id: 'CRB-439', tool: 'Torque Wrench 1/2"', assignee: 'J. Cruz', branch: 'ITPark', action: 'Check-Out' as CribAction, at: '09:40' },
  { id: 'CRB-438', tool: 'ATF Exchanger Hose', assignee: 'M. Dela Cruz', branch: 'Toledo', action: 'Check-In' as CribAction, at: '10:15' },
];

export const FTE_MOCK_SAFETY: NonNullable<FteDashboardProps['safetyChecklist']> = [
  { branch: 'Carmen', date: '2026-08-13', result: 'Pass' as SafetyResult, completedBy: 'STM Desk' },
  { branch: 'CebuCity', date: '2026-08-13', result: 'Pass' as SafetyResult, completedBy: 'Lead Tech' },
  { branch: 'Lapux2', date: '2026-08-13', result: 'Fail' as SafetyResult, completedBy: 'Shift Lead' },
  { branch: 'Bogo', date: '2026-08-13', result: 'Pass' as SafetyResult, completedBy: 'STM Desk' },
  { branch: 'ITPark', date: '2026-08-13', result: 'Pass' as SafetyResult, completedBy: 'Lead Tech' },
  { branch: 'Carx2', date: '2026-08-13', result: 'Fail' as SafetyResult, completedBy: '—' },
];

export const FTE_MOCK_CALIBRATION: NonNullable<FteDashboardProps['calibrationAlerts']> = [
  { asset: 'Torque Wrench Master', branch: 'Carmen', dueInDays: 2, serial: 'TW-8841' },
  { asset: 'Alignment Heads', branch: 'CebuCity', dueInDays: 5, serial: 'AL-2207' },
  { asset: 'Pressure Gauge Kit', branch: 'Toledo', dueInDays: 6, serial: 'PG-1190' },
  { asset: 'Multimeter Fluke', branch: 'Bogo', dueInDays: 7, serial: 'MM-552' },
];

function buildTxn(input: {
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
  /** When set, used as laborPrice (external flat invoice). Otherwise laborRate × serviceHours. */
  laborPriceOverride?: number;
  partsPrice: number;
  Payment_Method: string;
  Vendor_Supplier: string;
  Requested_By_User_ID: string;
  Approved_By_User_ID: string;
  Status: string;
}): FteTransaction {
  const laborPrice =
    input.laborPriceOverride != null
      ? Math.round(Number(input.laborPriceOverride) * 100) / 100
      : computeLaborPrice(input.laborRate, input.serviceHours);
  return {
    Transaction_ID: input.Transaction_ID,
    Transaction_Date: input.Transaction_Date,
    Transaction_Time: input.Transaction_Time,
    Branch_Name: input.Branch_Name,
    Asset_ID: input.Asset_ID,
    Asset_Name: input.Asset_Name,
    Asset_Category: input.Asset_Category,
    Transaction_Type: input.Transaction_Type,
    Description: input.Description,
    serviceRenderedBy: input.serviceRenderedBy,
    laborRate: input.laborRate,
    serviceHours: input.serviceHours,
    laborPrice,
    partsPrice: input.partsPrice,
    total: computeTransactionTotal(laborPrice, input.partsPrice),
    Payment_Method: input.Payment_Method,
    Vendor_Supplier: input.Vendor_Supplier,
    Requested_By_User_ID: input.Requested_By_User_ID,
    Approved_By_User_ID: input.Approved_By_User_ID,
    Status: input.Status,
  };
}

/** Initialized local FTE transaction database (20-column objects). */
export const FTE_MOCK_TRANSACTIONS: FteTransaction[] = [
  buildTxn({
    Transaction_ID: 'FTE-TXN-20260813-0001',
    Transaction_Date: '2026-08-13',
    Transaction_Time: '08:42:15',
    Branch_Name: 'Carmen',
    Asset_ID: 'AST-LFT-003',
    Asset_Name: '2-Post Lift #3',
    Asset_Category: 'Shop Equipment',
    Transaction_Type: 'Repair',
    Description: 'Hydraulic hose kit and seal replacement after bay leak',
    serviceRenderedBy: 'In-House Mechanic',
    laborRate: DEFAULT_INHOUSE_LABOR_RATE,
    serviceHours: 4,
    partsPrice: 12350,
    Payment_Method: 'Company Card',
    Vendor_Supplier: 'Industrial Supply PH',
    Requested_By_User_ID: 'USR-STM-014',
    Approved_By_User_ID: 'USR-GM-001',
    Status: 'Posted',
  }),
  buildTxn({
    Transaction_ID: 'FTE-TXN-20260812-0004',
    Transaction_Date: '2026-08-12',
    Transaction_Time: '14:18:03',
    Branch_Name: 'CebuCity',
    Asset_ID: 'AST-ALN-001',
    Asset_Name: 'Wheel Aligner Heads',
    Asset_Category: 'Calibration Asset',
    Transaction_Type: 'Calibration',
    Description: 'Annual camera head calibration and certificate renewal',
    serviceRenderedBy: 'Manufacturer Tech',
    laborRate: 0,
    serviceHours: 6,
    laborPriceOverride: 4800,
    partsPrice: 0,
    Payment_Method: 'Bank Transfer',
    Vendor_Supplier: 'Metro Cal Lab',
    Requested_By_User_ID: 'USR-TECH-027',
    Approved_By_User_ID: 'USR-STM-008',
    Status: 'Posted',
  }),
  buildTxn({
    Transaction_ID: 'FTE-TXN-20260811-0009',
    Transaction_Date: '2026-08-11',
    Transaction_Time: '10:05:41',
    Branch_Name: 'Bogo',
    Asset_ID: 'AST-PPE-LOT',
    Asset_Name: 'Shop PPE Restock Lot',
    Asset_Category: 'Safety Consumable',
    Transaction_Type: 'Purchase',
    Description: 'Gloves, goggles, and spill kit refill for bay ends',
    serviceRenderedBy: 'In-House Mechanic',
    laborRate: DEFAULT_INHOUSE_LABOR_RATE,
    serviceHours: 0,
    partsPrice: 2650.5,
    Payment_Method: 'Cash',
    Vendor_Supplier: 'Safety First Depot',
    Requested_By_User_ID: 'USR-LEAD-003',
    Approved_By_User_ID: 'USR-STM-014',
    Status: 'Posted',
  }),
  buildTxn({
    Transaction_ID: 'FTE-TXN-20260810-0012',
    Transaction_Date: '2026-08-10',
    Transaction_Time: '16:27:55',
    Branch_Name: 'Lapux2',
    Asset_ID: 'AST-CMP-002',
    Asset_Name: 'Air Compressor Bay 2',
    Asset_Category: 'Facility Equipment',
    Transaction_Type: 'Preventive Maintenance',
    Description: 'Compressor oil change, filter set, and pressure check',
    serviceRenderedBy: 'In-House Electrician',
    laborRate: DEFAULT_INHOUSE_LABOR_RATE,
    serviceHours: 2,
    partsPrice: 2420,
    Payment_Method: 'Company Card',
    Vendor_Supplier: 'AirTech Parts',
    Requested_By_User_ID: 'USR-FAC-002',
    Approved_By_User_ID: 'USR-GM-001',
    Status: 'Posted',
  }),
  buildTxn({
    Transaction_ID: 'FTE-TXN-20260809-0007',
    Transaction_Date: '2026-08-09',
    Transaction_Time: '09:33:12',
    Branch_Name: 'ITPark',
    Asset_ID: 'AST-TW-012',
    Asset_Name: 'Torque Wrench 1/2" TW-12',
    Asset_Category: 'Hand Tool',
    Transaction_Type: 'Tool Replacement',
    Description: 'Replace damaged torque wrench from tool crib inventory',
    serviceRenderedBy: 'Third-Party Provider',
    laborRate: 0,
    serviceHours: 0.5,
    laborPriceOverride: 175,
    partsPrice: 4075,
    Payment_Method: 'Petty Cash',
    Vendor_Supplier: 'Tool World Cebu',
    Requested_By_User_ID: 'USR-TECH-041',
    Approved_By_User_ID: 'USR-STM-008',
    Status: 'Pending Approval',
  }),
  buildTxn({
    Transaction_ID: 'FTE-TXN-20260808-0015',
    Transaction_Date: '2026-08-08',
    Transaction_Time: '11:50:28',
    Branch_Name: 'Toledo',
    Asset_ID: 'AST-GEN-001',
    Asset_Name: 'Backup Generator',
    Asset_Category: 'Facility Equipment',
    Transaction_Type: 'Service Contract',
    Description: 'Monthly load test service and diesel stabilizer top-up',
    serviceRenderedBy: 'In-House Mechanic',
    laborRate: DEFAULT_INHOUSE_LABOR_RATE,
    serviceHours: 3,
    partsPrice: 5800,
    Payment_Method: 'Bank Transfer',
    Vendor_Supplier: 'PowerSafe Facilities',
    Requested_By_User_ID: 'USR-FAC-002',
    Approved_By_User_ID: 'USR-GM-001',
    Status: 'Posted',
  }),
  buildTxn({
    Transaction_ID: 'FTE-TXN-20260813-0018',
    Transaction_Date: '2026-08-13',
    Transaction_Time: '15:22:40',
    Branch_Name: 'CebuCity',
    Asset_ID: 'AST-LFT-007',
    Asset_Name: '2-Post Lift #1',
    Asset_Category: 'Shop Equipment',
    Transaction_Type: 'Repair',
    Description: 'Safety latch inspection and arm pad replacement',
    serviceRenderedBy: 'In-House Mechanic',
    laborRate: DEFAULT_INHOUSE_LABOR_RATE,
    serviceHours: 2,
    partsPrice: 1850,
    Payment_Method: 'Company Card',
    Vendor_Supplier: 'Industrial Supply PH',
    Requested_By_User_ID: 'USR-SA-021',
    Approved_By_User_ID: '',
    Status: 'Pending Approval',
  }),
];

export const FTE_MOCK_DASHBOARD: FteDashboardProps = {
  ...FTE_MOCK_SUMMARY,
  emergencyOrders: FTE_MOCK_EMERGENCY,
  scheduledPm: FTE_MOCK_PM,
  recentExpenses: FTE_MOCK_EXPENSES,
  cribTracker: FTE_MOCK_CRIB,
  safetyChecklist: FTE_MOCK_SAFETY,
  calibrationAlerts: FTE_MOCK_CALIBRATION,
  transactions: FTE_MOCK_TRANSACTIONS,
};
