const express = require('express');
const store = require('../data/store');
const { isIncomingStockType, isPartsActivityLog, TYPE_STOCK, TYPE_SOLD } = require('../lib/parts-request');
const inventory = require('../lib/parts-inventory-controller');
const { frontlineSessionBranch } = require('../lib/frontline-roles');
const { canonicalizeBranchName, normalizeBranchKey } = require('../lib/branches');
const { WAREHOUSE_1 } = require('../lib/parts-location-scope');
const { saveBillingPdf, BILLING_WARRANTY_NOTE } = require('../lib/billing-pdf');
const { loadLaborPriceMatrix } = require('../lib/labor-price-matrix');
const {
  loadVehicleTypeCatalog,
  lookupUnitType,
  toStoredVehicleType,
  toUiVehicleType,
} = require('../lib/vehicle-type-catalog');
const {
  workOrderStatusOptions,
  formatWorkOrderStatusLabel,
  resolveWorkOrderLifecycleStatus,
} = require('../lib/work-order-status');
const {
  PAYMENT_STATUS,
  computeInvoiceEconomics,
  financeFieldsFromSnapshot,
  buildPartsCostIndex,
} = require('../lib/finance-ledger');
const router = express.Router();

router.use((req, res, next) => {
  res.locals.workOrderStatusOptions = workOrderStatusOptions();
  res.locals.formatWorkOrderStatusLabel = formatWorkOrderStatusLabel;
  next();
});

const VAT_RATE = 0.12;
const WORK_ORDER_NUMBER_PATTERN = /^\d{7}$/;

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeKey(value) {
  return normalizeText(value).toLowerCase();
}

function receptionistBranch(req) {
  const user = req.session && req.session.user ? req.session.user : {};
  return frontlineSessionBranch(user);
}

function filterForReceptionistBranch(req, workOrders) {
  const branch = receptionistBranch(req);
  return branch
    ? (workOrders || []).filter(wo => normalizeBranchKey(wo.branch) === normalizeBranchKey(branch))
    : workOrders;
}

async function scopeCustomerVehicleData(req, customers, vehicles) {
  const branch = receptionistBranch(req);
  if (!branch) return { customers, vehicles };
  const workOrders = filterForReceptionistBranch(req, await store.getAll('work_orders'));
  const customerIds = new Set(workOrders.map(wo => wo.customer_id).filter(Boolean));
  const vehicleIds = new Set(workOrders.map(wo => wo.vehicle_id).filter(Boolean));
  return {
    customers: (customers || []).filter(customer => customerIds.has(customer.id) || normalizeBranchKey(customer.branch) === normalizeBranchKey(branch)),
    vehicles: (vehicles || []).filter(vehicle => vehicleIds.has(vehicle.id) || normalizeBranchKey(vehicle.branch) === normalizeBranchKey(branch)),
  };
}

function normalizeVehicleType(value) {
  return toStoredVehicleType(value) || 'small';
}

function applyCatalogUnitType(body, vehicleCatalog) {
  const match = lookupUnitType(vehicleCatalog, body && body.car_brand, body && body.car_model);
  if (!match) return body;
  body.vehicle_type = match.vehicleTypeUi || toUiVehicleType(match.vehicleType);
  if (match.brand) body.car_brand = match.brand;
  if (match.model) body.car_model = match.model;
  return body;
}

function getTechnicianDisplayName(employee) {
  const name = [employee && employee.first_name, employee && employee.middle_name, employee && employee.last_name]
    .filter(Boolean)
    .map(value => String(value).trim())
    .join(' ')
    .trim();
  const identifier = normalizeText(employee && employee.employee_id);
  if (name && identifier) return `${name} (${identifier})`;
  return name || identifier;
}

function buildTechnicianDirectory(employees) {
  return (employees || [])
    .filter((employee) => (
      normalizeText(employee && employee.employee_id) &&
      normalizeText(employee && employee.work_location_branch_id)
    ))
    .map((employee) => ({
      id: employee.id || '',
      employee_id: employee.employee_id || '',
      name: getTechnicianDisplayName(employee),
      branch: normalizeText(employee.work_location_branch_id),
      branch_key: normalizeBranchKey(employee.work_location_branch_id),
      job_title: normalizeText(employee.job_title),
    }))
    .filter((employee) => employee.name);
}

function buildBranchOptionsFromEmployees(employees) {
  const byKey = new Map();

  (employees || []).forEach((employee) => {
    const label = normalizeText(employee && employee.work_location_branch_id);
    if (!label) return;
    const key = normalizeBranchKey(label);
    if (!key) return;
    if (!byKey.has(key)) {
      byKey.set(key, label);
    }
  });

  return Array.from(byKey.values()).sort((a, b) => a.localeCompare(b));
}

function resolveWorkOrderVehicleType(wo, vehicle, vehicleCatalog) {
  const brand = normalizeText(wo && wo.car_brand) || normalizeText(vehicle && vehicle.make);
  const model = normalizeText(wo && wo.car_model) || normalizeText(vehicle && vehicle.model);
  const matched = lookupUnitType(vehicleCatalog, brand, model);
  if (matched && matched.vehicleType) return matched.vehicleType;
  return normalizeVehicleType(vehicle && vehicle.vehicle_type);
}

async function resolveCustomerId(body, customers) {
  const existingId = normalizeText(body.customer_id);
  if (existingId) return existingId;

  const customerEntry = normalizeText(body.customer_entry);
  if (!customerEntry) return '';

  const existing = customers.find(customer => normalizeKey(customer.name) === normalizeKey(customerEntry));
  if (existing) {
    const phone = normalizeText(body.telephone_number);
    if (phone && phone !== normalizeText(existing.phone)) {
      await store.update('customers', existing.id, { phone });
    }
    return existing.id;
  }

  const created = await store.create('customers', {
    name: customerEntry,
    phone: normalizeText(body.telephone_number),
    email: '',
    address: '',
    notes: 'Auto-created from work order form',
  });
  return created.id;
}

async function resolveVehicleId(body, vehicles, customerId, vehicleCatalog) {
  const existingId = normalizeText(body.vehicle_id);
  const catalogMatch = lookupUnitType(vehicleCatalog, body && body.car_brand, body && body.car_model);
  const selectedVehicleType = catalogMatch && catalogMatch.vehicleType
    ? catalogMatch.vehicleType
    : normalizeVehicleType(body.vehicle_type);
  if (existingId) {
    const existingVehicle = await store.getById('vehicles', existingId);
    if (existingVehicle) {
      await store.update('vehicles', existingId, {
        vehicle_type: selectedVehicleType || existingVehicle.vehicle_type || 'small',
      });
    }
    return existingId;
  }

  const make = normalizeText(body.car_brand);
  const model = normalizeText(body.car_model);
  const year = normalizeText(body.car_year);
  const plate = normalizeText(body.plate_number);

  if (!make && !model && !plate) return '';

  const existing = vehicles.find(vehicle => (
    normalizeKey(vehicle.make) === normalizeKey(make) &&
    normalizeKey(vehicle.model) === normalizeKey(model) &&
    normalizeKey(vehicle.year) === normalizeKey(year) &&
    normalizeKey(vehicle.license_plate) === normalizeKey(plate)
  ));
  if (existing) {
    const patch = {
      customer_id: customerId || existing.customer_id || '',
      make: make || existing.make || '',
      model: model || existing.model || '',
      year: year || existing.year || '',
      license_plate: plate || existing.license_plate || '',
      vehicle_type: selectedVehicleType || existing.vehicle_type || 'small',
    };
    await store.update('vehicles', existing.id, patch);
    return existing.id;
  }

  const created = await store.create('vehicles', {
    customer_id: customerId || '',
    make,
    model,
    year,
    vin: '',
    license_plate: plate,
    vehicle_type: selectedVehicleType || 'small',
  });
  return created.id;
}

function toNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function asMoney(value) {
  return toNumber(value).toFixed(2);
}

function formatInvoiceDate(value) {
  const raw = normalizeText(value);
  if (!raw) return '';
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  return parsed.toLocaleDateString('en-PH');
}

function buildBillingInvoice(wo, customer, vehicle) {
  const items = wo.service_items || [];
  const labor_total = items.reduce((sum, item) => sum + (Number(item.labor_price || 0) * Math.max(1, Number(item.service_qty) || 1)), 0);
  const parts_total = items.reduce((s, i) => s + getPartsLineTotal(i), 0);
  const subtotal = labor_total + parts_total;
  const tax = Number((subtotal * VAT_RATE).toFixed(2));
  const total = Number((subtotal + tax).toFixed(2));
  const invoiceLines = [];
  items.forEach((item) => {
    const serviceQty = Math.max(1, Number(item.service_qty) || 1);
    const laborUnitPrice = Number(item.labor_price) || 0;
    if (laborUnitPrice > 0 || normalizeText(item.description) || normalizeText(item.reason)) {
      invoiceLines.push({
        description: normalizeText(item.description) || normalizeText(item.reason) || 'Labor service',
        quantity: serviceQty,
        unit: 'service',
        unitPrice: laborUnitPrice,
        amount: laborUnitPrice * serviceQty,
      });
    }

    const partsQty = Math.max(0, Number(item.parts_qty) || 0);
    const partsUnitPrice = Number(item.parts_price) || 0;
    if (partsQty > 0 || partsUnitPrice > 0 || normalizeText(item.parts)) {
      invoiceLines.push({
        description: normalizeText(item.parts) || 'Parts/materials',
        quantity: partsQty || 1,
        unit: normalizeText(item.unit) || 'piece',
        unitPrice: partsUnitPrice,
        amount: partsQty > 0 ? partsQty * partsUnitPrice : partsUnitPrice,
      });
    }
  });

  return {
    wo,
    customer,
    vehicle,
    items,
    labor_total,
    parts_total,
    subtotal,
    tax,
    total,
    invoiceLines,
    invoiceNumber: normalizeText(wo.invoice_number) || normalizeWorkOrderNumber(wo.work_order_number, wo.id),
    invoiceDate: normalizeText(wo.invoice_date) || normalizeText(wo.created_at),
    invoiceDateLabel: formatInvoiceDate(normalizeText(wo.invoice_date) || normalizeText(wo.created_at)),
    seller: {
      registeredName: normalizeText(process.env.INVOICE_REGISTERED_NAME) || 'A&E AUTO SERVICE GROUP INC.',
      businessName: normalizeText(process.env.INVOICE_BUSINESS_NAME) || 'A&E Auto Service Group Inc.',
      address: normalizeText(process.env.INVOICE_REGISTERED_ADDRESS) || 'CONFIGURE REGISTERED BUSINESS ADDRESS',
      tin: normalizeText(process.env.INVOICE_TIN) || 'CONFIGURE TIN',
      branchCode: normalizeText(process.env.INVOICE_BRANCH_CODE) || normalizeText(wo.branch),
      phone: normalizeText(process.env.INVOICE_PHONE) || 'CONFIGURE BUSINESS PHONE',
      atpNumber: normalizeText(process.env.INVOICE_ATP_NUMBER),
      printerAccreditation: normalizeText(process.env.INVOICE_PRINTER_ACCREDITATION),
    },
  };
}

function saveInvoicePdfCopy(invoice) {
  try {
    return saveBillingPdf(invoice);
  } catch (error) {
    console.error('Failed to save billing PDF', error);
    return { ok: false, error: error.message || 'Unable to save billing PDF.' };
  }
}

function getPartsLineTotal(item) {
  const qtyRaw = Number(item && item.parts_qty);
  const qty = Number.isFinite(qtyRaw) && qtyRaw >= 0 ? qtyRaw : 0;
  const unitPrice = toNumber(item && item.parts_price);
  return qty * unitPrice;
}

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function normalizePartNumber(value) {
  return String(value || '').trim().toUpperCase();
}

function normalizePartNumberKey(value) {
  const raw = normalizePartNumber(value);
  if (!raw) return '';
  if (/^\d+$/.test(raw)) {
    return raw.replace(/^0+(?=\d)/, '');
  }
  return raw;
}

function normalizeRoleLabel(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'service_advisor') return 'SA';
  if (raw === 'service_receptionist') return 'SR';
  if (raw === 'senior_service_receptionist') return 'SSR';
  if (raw === 'technician') return 'Technician';
  return raw ? raw.replace(/_/g, ' ') : 'System';
}

async function getWorkOrderTechnicianUpdates(workOrderId) {
  const updates = await store.getAll('technician_updates');
  return (updates || [])
    .filter((entry) => String(entry.work_order_id || '').trim() === String(workOrderId || '').trim())
    .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());
}

function buildPartsInventoryIndex(partsInventory) {
  const index = new Map();

  for (const row of partsInventory || []) {
    const partNumberRaw = normalizePartNumber(row.part_number);
    const partNumberKey = normalizePartNumberKey(partNumberRaw);
    if (!partNumberKey) continue;

    const type = String(row.transaction_type || '').trim();
    const qty = Math.max(0, toNumber(row.qty));

    const current = index.get(partNumberKey) || {
      part_number: partNumberRaw,
      part_name: '',
      sub_id: '',
      generic: '',
      supplier: '',
      unit: '',
      cost_price: 0,
      markup: 0,
      retail_price: 0,
      stock: 0,
      present_location: '',
      branch: '',
      created_branch: '',
    };

    if (row.part_name) current.part_name = String(row.part_name);
    if (row.sub_id) current.sub_id = String(row.sub_id);
    if (row.generic) current.generic = String(row.generic);
    if (row.supplier) current.supplier = String(row.supplier);
    if (row.unit) current.unit = String(row.unit).trim();
    if (!isPartsActivityLog(row)) {
      if (row.present_location) current.present_location = String(row.present_location);
      if (row.branch) current.branch = String(row.branch);
    }
    if (row.created_branch) current.created_branch = String(row.created_branch);

    const latestCost = toNumber(row.cost_price);
    const latestMarkup = toNumber(row.markup);
    const latestRetail = toNumber(row.retail_price);
    if (latestCost > 0) current.cost_price = latestCost;
    if (latestMarkup >= 0) current.markup = latestMarkup;
    if (latestRetail > 0) current.retail_price = latestRetail;

    if (isIncomingStockType(type) && !isPartsActivityLog(row)) {
      current.stock += qty;
    }

    if (!current.part_number) current.part_number = partNumberRaw;
    index.set(partNumberKey, current);
  }

  return index;
}

function deductFromSourceStockRows(partsInventory, partNumberKey, qtyToDeduct, data) {
  let remaining = Math.max(0, toNumber(qtyToDeduct));
  if (remaining <= 0) return true;

  for (const row of partsInventory || []) {
    const rowKey = normalizePartNumberKey(row.part_number);
    const type = String(row.transaction_type || '').trim();
    if (rowKey !== partNumberKey) continue;
    if (isPartsActivityLog(row)) continue;
    if (!isIncomingStockType(type)) continue;

    const available = Math.max(0, toNumber(row.qty));
    if (available <= 0) continue;

    const consumed = Math.min(available, remaining);
    row.qty = Number((available - consumed).toFixed(2));
    if (data) inventory.syncInventoryRowToTransactions(data, row);
    remaining = Number((remaining - consumed).toFixed(2));
    if (remaining <= 0) return true;
  }

  return false;
}

function buildPartsCatalog(partsInventory) {
  const index = buildPartsInventoryIndex(partsInventory);
  return Array.from(index.values())
    .sort((a, b) => a.part_number.localeCompare(b.part_number));
}

function collectPartUsage(serviceItems) {
  const usage = new Map();

  for (const item of serviceItems || []) {
    const partNumber = normalizePartNumberKey(item.part_number);
    if (!partNumber) continue;
    const qty = Math.max(0, Math.floor(toNumber(item.parts_qty)));
    if (qty <= 0) continue;
    usage.set(partNumber, (usage.get(partNumber) || 0) + qty);
  }

  return usage;
}

async function applyPartsInventoryAdjustments(existingItems, nextItems, workOrderNumber, username) {
  const data = await store.getRawData();
  const partsInventory = Array.isArray(data.parts_inventory) ? data.parts_inventory : [];
  const index = buildPartsInventoryIndex(partsInventory);

  const existingUsage = collectPartUsage(existingItems);
  const nextUsage = collectPartUsage(nextItems);
  const allPartNumbers = new Set([...existingUsage.keys(), ...nextUsage.keys()]);
  const deltas = [];

  for (const partNumber of allPartNumbers) {
    const delta = (nextUsage.get(partNumber) || 0) - (existingUsage.get(partNumber) || 0);
    if (delta !== 0) deltas.push({ partNumber, delta });
  }

  const errors = [];
  for (const change of deltas) {
    if (change.delta <= 0) continue;
    const stockInfo = index.get(normalizePartNumberKey(change.partNumber));
    if (!stockInfo) {
      errors.push(`Part Number ${change.partNumber} was not found in Parts Database.`);
      continue;
    }
    if (stockInfo.stock < change.delta) {
      errors.push(`Insufficient stock for ${change.partNumber}. Available: ${stockInfo.stock}, Required: ${change.delta}.`);
    }
  }

  if (errors.length) {
    return { ok: false, error: errors.join(' ') };
  }

  const today = new Date().toISOString().slice(0, 10);
  for (const change of deltas) {
    const key = normalizePartNumberKey(change.partNumber);
    const stockInfo = index.get(key) || {
      part_number: normalizePartNumber(change.partNumber),
      part_name: '',
      sub_id: '',
      generic: '',
      supplier: '',
      cost_price: 0,
      markup: 0,
      retail_price: 0,
      stock: 0,
    };

    const qty = Math.abs(change.delta);
    const isSold = change.delta > 0;

    if (isSold) {
      const deducted = deductFromSourceStockRows(partsInventory, key, qty, data);
      if (!deducted) {
        return { ok: false, error: `Unable to transfer stock for ${stockInfo.part_number}. Please verify stock entries.` };
      }
    }

    const physicalLocation = String(
      stockInfo.present_location || stockInfo.created_branch || stockInfo.branch || ''
    ).trim();
    const createdBranch = String(stockInfo.created_branch || physicalLocation).trim();

    const movement = {
      id: genId(),
      created_at: new Date().toISOString(),
      transaction_date: today,
      transaction_type: isSold ? TYPE_SOLD : TYPE_STOCK,
      present_location: physicalLocation,
      branch: physicalLocation,
      created_branch: createdBranch,
      editor: String(username || '').trim(),
      part_number: stockInfo.part_number,
      part_name: stockInfo.part_name || '',
      sub_id: stockInfo.sub_id || '',
      generic: stockInfo.generic || '',
      supplier: stockInfo.supplier || '',
      unit: stockInfo.unit || '',
      qty,
      cost_price: toNumber(stockInfo.cost_price),
      markup: toNumber(stockInfo.markup),
      retail_price: toNumber(stockInfo.retail_price),
      sold_to: isSold ? String(workOrderNumber || '') : `${String(workOrderNumber || '')}-ADJUSTMENT`,
    };
    partsInventory.push(movement);
    inventory.rememberTransaction(data, movement);

    if (isSold) {
      const soldLog = {
        id: genId(),
        created_at: new Date().toISOString(),
        created_via: 'create-parts-log',
        activity_log: true,
        source_part_id: movement.id,
        created_branch: createdBranch,
        transaction_date: today,
        transaction_type: TYPE_SOLD,
        present_location: WAREHOUSE_1,
        branch: WAREHOUSE_1,
        editor: String(username || '').trim(),
        part_number: stockInfo.part_number,
        part_name: stockInfo.part_name || '',
        sub_id: stockInfo.sub_id || '',
        generic: stockInfo.generic || '',
        supplier: stockInfo.supplier || '',
        unit: stockInfo.unit || '',
        qty,
        cost_price: toNumber(stockInfo.cost_price),
        markup: toNumber(stockInfo.markup),
        retail_price: toNumber(stockInfo.retail_price),
        sold_to: String(workOrderNumber || ''),
      };
      partsInventory.push(soldLog);
      inventory.rememberTransaction(data, soldLog);
    }

    stockInfo.stock += isSold ? -qty : qty;
    index.set(key, stockInfo);
    inventory.rebuildPartCatalogEntry(data, stockInfo.part_number);
  }

  data.parts_inventory = partsInventory;
  await store.replaceData(data);
  return { ok: true };
}

async function generateNextWorkOrderNumber() {
  const items = await store.getAll('work_orders');
  let max = 0;
  for (const wo of items) {
    const normalized = normalizeWorkOrderNumber(wo.work_order_number);
    const value = Number(normalized);
    if (Number.isFinite(value) && value > max) max = value;
  }
  return String(max + 1).padStart(7, '0');
}

function normalizeWorkOrderNumber(value, fallbackDigits) {
  const candidate = String(value || '').trim();
  const digits = candidate.replace(/\D/g, '');
  if (WORK_ORDER_NUMBER_PATTERN.test(candidate)) {
    return candidate;
  }
  if (digits) {
    return digits.slice(-7).padStart(7, '0');
  }
  return String(fallbackDigits || 0).replace(/\D/g, '').slice(-7).padStart(7, '0');
}

function computeTotals(items) {
  const laborTotal = items.reduce((sum, item) => sum + (toNumber(item.labor_price) * Math.max(1, toNumber(item.service_qty) || 1)), 0);
  const partsTotal = items.reduce((sum, item) => sum + getPartsLineTotal(item), 0);
  const grandTotal = laborTotal + partsTotal;
  const vat = Number((grandTotal * VAT_RATE).toFixed(2));
  const totalWithVat = Number((grandTotal + vat).toFixed(2));
  return { laborTotal, partsTotal, grandTotal, vat, totalWithVat };
}

function splitParts(text) {
  const raw = String(text || '').trim();
  if (!raw) return [];
  const values = raw.split(/[,;]+/).map(v => v.trim()).filter(Boolean);
  return values.length ? values : [raw];
}

function buildTransactionRecord(wo, customer, vehicle, action, audit = {}, partsIndex) {
  const items = wo.service_items || [];
  const totals = computeTotals(items);
  const parts = [];
  const partPrices = [];

  items.forEach(item => {
    const names = splitParts(item.parts);
    if (!names.length && getPartsLineTotal(item) > 0) {
      names.push('');
    }
    const qty = Math.max(0, Number(item.parts_qty) || 0);
    const qtyLabel = qty ? ` x${qty}` : '';
    const linePrice = getPartsLineTotal(item);
    names.forEach(name => {
      if (parts.length < 50) {
        parts.push(`${name || ''}${qtyLabel}`.trim());
        partPrices.push(asMoney(linePrice));
      }
    });
  });

  const record = {
    work_order_id: wo.id,
    transaction_action: action,
    action_by: normalizeText(audit.username),
    action_by_role: normalizeText(audit.role),
    'Transaction date': new Date().toISOString(),
    'Branch': canonicalizeBranchName(wo.branch || ''),
    'work order Number': normalizeWorkOrderNumber(wo.work_order_number),
    'Customer name': customer.name || '',
    'Telephone number': wo.telephone_number || customer.phone || '',
    'Car Brand': wo.car_brand || vehicle.make || '',
    'Model': wo.car_model || vehicle.model || '',
    'Year': wo.car_year || vehicle.year || '',
    'Service Advice Advisor': wo.service_advisor || '',
    'Tecnician': wo.technician || '',
    'Total Labor': asMoney(totals.laborTotal),
    'Total Parts': asMoney(totals.partsTotal),
    'Grand Total': asMoney(totals.grandTotal),
    'Vat': asMoney(totals.vat),
    'Totalwith Vat': asMoney(totals.totalWithVat),
    'TimeIn': wo.time_in || '',
    'TimeOut': wo.time_out || '',
    ...financeFieldsFromSnapshot(computeInvoiceEconomics(wo, partsIndex), {
      paymentMethod: wo.paymentMethod || wo.payment_method || '',
      paymentStatus: wo.paymentStatus || wo.payment_status || (
        String(action || '').indexOf('billing') === 0 ? PAYMENT_STATUS.UNPAID : ''
      ),
    }),
  };

  for (let i = 1; i <= 15; i += 1) {
    const item = items[i - 1] || {};
    record[`Service${i}`] = item.reason || item.service_type || item.description || '';
    record[`Labor${i}`] = item.labor_price != null && item.labor_price !== '' ? asMoney(item.labor_price) : '';
  }

  for (let i = 1; i <= 10; i += 1) {
    const item = items[i - 1] || {};
    record[`Service Required${i}`] = item.description || '';
  }

  for (let i = 1; i <= 50; i += 1) {
    record[`Part${i}`] = parts[i - 1] || '';
    record[`Parts Price${i}`] = partPrices[i - 1] || '';
  }

  return record;
}

async function saveTransactionRecord(workOrderId, action, audit = {}) {
  const wo = await store.getById('work_orders', workOrderId);
  if (!wo) return;
  const customer = wo.customer_id ? (await store.getById('customers', wo.customer_id)) || {} : {};
  const vehicle = wo.vehicle_id ? (await store.getById('vehicles', wo.vehicle_id)) || {} : {};
  const partsIndex = buildPartsCostIndex(await store.getAll('parts_inventory'));
  const record = buildTransactionRecord(wo, customer, vehicle, action, audit, partsIndex);
  await store.create('transaction_records', record);
}

function mergeWorkOrderMask(body, customer, vehicle) {
  return {
    telephone_number: normalizeText(body.telephone_number) || normalizeText(customer.phone),
    car_brand: normalizeText(body.car_brand) || normalizeText(vehicle.make),
    car_model: normalizeText(body.car_model) || normalizeText(vehicle.model),
    car_year: normalizeText(body.car_year) || normalizeText(vehicle.year),
    plate_number: normalizeText(body.plate_number) || normalizeText(vehicle.license_plate),
    odometer: normalizeText(body.odometer),
  };
}

function getCurrentTimeHHMM() {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function isClosedWorkOrder(wo) {
  return String((wo && wo.status) || '').trim().toLowerCase() === 'closed';
}

function getWorkOrderSortValue(wo) {
  const createdAt = new Date(wo && wo.created_at ? wo.created_at : 0).getTime();
  if (Number.isFinite(createdAt) && createdAt > 0) return createdAt;

  const normalizedNumber = Number(normalizeWorkOrderNumber(wo && wo.work_order_number, wo && wo.id));
  if (Number.isFinite(normalizedNumber) && normalizedNumber > 0) return normalizedNumber;

  const idNumber = Number(String((wo && wo.id) || '').replace(/\D/g, ''));
  if (Number.isFinite(idNumber) && idNumber > 0) return idNumber;

  return 0;
}

router.get('/', async (req, res) => {
  const work_orders = filterForReceptionistBranch(req, await store.getAll('work_orders'));
  const orderedWorkOrders = work_orders
    .slice()
    .sort((a, b) => {
      const aClosed = isClosedWorkOrder(a) ? 1 : 0;
      const bClosed = isClosedWorkOrder(b) ? 1 : 0;
      if (aClosed !== bClosed) return aClosed - bClosed;

      return getWorkOrderSortValue(b) - getWorkOrderSortValue(a);
    });
  const customers = await store.getAll('customers');
  const vehicles = await store.getAll('vehicles');
  res.render('workorders/index', {
    work_orders: orderedWorkOrders,
    customers,
    vehicles,
  });
});

router.get('/new', async (req, res) => {
  let customers = await store.getAll('customers');
  let vehicles = await store.getAll('vehicles');
  ({ customers, vehicles } = await scopeCustomerVehicleData(req, customers, vehicles));
  const employees = await store.getAll('employees');
  const vehicleCatalog = await loadVehicleTypeCatalog();
  const branchOptions = buildBranchOptionsFromEmployees(employees);
  const technicianDirectory = buildTechnicianDirectory(employees);
  const loginBranch = receptionistBranch(req);
  let prefill = loginBranch ? { branch: loginBranch } : {};

  if (req.query.copyFrom) {
    const source = await store.getById('work_orders', req.query.copyFrom);
    if (source && (!loginBranch || normalizeBranchKey(source.branch) === normalizeBranchKey(loginBranch))) {
      const sourceCustomer = source.customer_id ? (await store.getById('customers', source.customer_id)) || {} : {};
      const sourceVehicle = source.vehicle_id ? (await store.getById('vehicles', source.vehicle_id)) || {} : {};
      prefill = {
        customer_id: source.customer_id || '',
        customer_entry: sourceCustomer.name || '',
        telephone_number: source.telephone_number || sourceCustomer.phone || '',
        vehicle_id: source.vehicle_id || '',
        car_brand: source.car_brand || sourceVehicle.make || '',
        car_model: source.car_model || sourceVehicle.model || '',
        car_year: source.car_year || sourceVehicle.year || '',
        plate_number: source.plate_number || sourceVehicle.license_plate || '',
        vehicle_type: sourceVehicle.vehicle_type || 'small',
        branch: source.branch || '',
      };
    }
  }

  applyCatalogUnitType(prefill, vehicleCatalog);

  res.render('workorders/new', {
    customers,
    vehicles,
    vehicleCatalog,
    branchOptions: loginBranch ? [loginBranch] : branchOptions,
    technicianDirectory,
    vehicleTypeError: req.query.vehicleTypeError || '',
    prefill,
  });
});

router.post('/new', async (req, res) => {
  let customers = await store.getAll('customers');
  let vehicles = await store.getAll('vehicles');
  ({ customers, vehicles } = await scopeCustomerVehicleData(req, customers, vehicles));
  const employees = await store.getAll('employees');
  const vehicleCatalog = await loadVehicleTypeCatalog();
  const branchOptions = buildBranchOptionsFromEmployees(employees);
  const technicianDirectory = buildTechnicianDirectory(employees);
  applyCatalogUnitType(req.body, vehicleCatalog);

  if (!normalizeText(req.body.vehicle_type)) {
    return res.status(400).render('workorders/new', {
      customers,
      vehicles,
      vehicleCatalog,
      branchOptions,
      technicianDirectory,
      vehicleTypeError: 'Please Select the Unit Type',
      prefill: req.body,
    });
  }

  const customer_id = await resolveCustomerId(req.body, customers);
  const vehicle_id = await resolveVehicleId(req.body, vehicles, customer_id, vehicleCatalog);
  const selectedCustomer = customer_id ? (await store.getById('customers', customer_id)) || {} : {};
  const selectedVehicle = vehicle_id ? (await store.getById('vehicles', vehicle_id)) || {} : {};

  const {
    description,
    status,
    branch,
    service_advisor,
    technician,
    time_in,
    time_out,
  } = req.body;
  const normalizedTechnician = (technician || '').trim();
  const normalizedTimeIn = (time_in || '').trim();
  const technicianAssignedAt = normalizedTechnician ? new Date().toISOString() : '';

  const generatedNumber = await generateNextWorkOrderNumber();

  const wo = await store.create('work_orders', {
    customer_id,
    vehicle_id,
    description,
    status: resolveWorkOrderLifecycleStatus({
      hasTechnician: Boolean(normalizedTechnician),
      postedStatus: status,
      currentStatus: 'open',
    }),
    branch: canonicalizeBranchName(branch || receptionistBranch(req) || ''),
    work_order_number: normalizeWorkOrderNumber(generatedNumber, generatedNumber),
    service_advisor: (service_advisor || '').trim(),
    technician: normalizedTechnician,
    technician_assigned_at: technicianAssignedAt,
    time_in: normalizedTechnician ? (normalizedTimeIn || getCurrentTimeHHMM()) : '',
    time_out: (time_out || '').trim(),
    ...mergeWorkOrderMask(req.body, selectedCustomer, selectedVehicle),
  });
  await saveTransactionRecord(wo.id, 'created');
  res.redirect('/work-orders');
});

router.get('/:id/edit', async (req, res) => {
  const wo = await store.getById('work_orders', req.params.id);
  if (!wo) return res.redirect('/work-orders');
  let customers = await store.getAll('customers');
  let vehicles = await store.getAll('vehicles');
  ({ customers, vehicles } = await scopeCustomerVehicleData(req, customers, vehicles));
  const employees = await store.getAll('employees');
  const vehicleCatalog = await loadVehicleTypeCatalog();
  const branchOptions = buildBranchOptionsFromEmployees(employees);
  const technicianDirectory = buildTechnicianDirectory(employees);
  const technicianUpdates = await getWorkOrderTechnicianUpdates(wo.id);
  res.render('workorders/edit', {
    wo,
    customers,
    vehicles,
    vehicleCatalog,
    branchOptions: receptionistBranch(req) ? [receptionistBranch(req)] : branchOptions,
    technicianDirectory,
    technicianUpdates,
    communicationOk: req.query.communicationOk || '',
    communicationError: req.query.communicationError || '',
    normalizeRoleLabel,
    printError: req.query.printError || '',
    lockedError: req.query.lockedError || '',
  });
});

router.post('/:id/edit', async (req, res) => {
  const existingWo = await store.getById('work_orders', req.params.id);
  if (!existingWo) return res.redirect('/work-orders');
  if (isClosedWorkOrder(existingWo)) {
    return res.redirect(`/work-orders/${req.params.id}/edit?lockedError=Work%20Order%20is%20closed%20and%20can%20no%20longer%20be%20edited.`);
  }

  let customers = await store.getAll('customers');
  let vehicles = await store.getAll('vehicles');
  ({ customers, vehicles } = await scopeCustomerVehicleData(req, customers, vehicles));
  const vehicleCatalog = await loadVehicleTypeCatalog();
  applyCatalogUnitType(req.body, vehicleCatalog);

  const customer_id = await resolveCustomerId(req.body, customers);
  const vehicle_id = await resolveVehicleId(req.body, vehicles, customer_id, vehicleCatalog);
  const selectedCustomer = customer_id ? (await store.getById('customers', customer_id)) || {} : {};
  const selectedVehicle = vehicle_id ? (await store.getById('vehicles', vehicle_id)) || {} : {};

  const {
    description,
    status,
    branch,
    service_advisor,
    technician,
    time_in,
    time_out,
  } = req.body;
  const normalizedTechnician = (technician || '').trim();
  const normalizedTimeIn = (time_in || '').trim();
  const hadTechnician = String(existingWo.technician || '').trim().length > 0;
  const hasTechnicianNow = normalizedTechnician.length > 0;
  const nextTechnicianAssignedAt = hasTechnicianNow
    ? (hadTechnician ? (existingWo.technician_assigned_at || '') : new Date().toISOString())
    : '';
  const currentStatus = String(existingWo.status || '').trim().toLowerCase();
  const nextStatus = isClosedWorkOrder(existingWo)
    ? 'closed'
    : resolveWorkOrderLifecycleStatus({
      hasTechnician: hasTechnicianNow,
      postedStatus: status,
      currentStatus: currentStatus || 'open',
    });
  await store.update('work_orders', req.params.id, {
    customer_id,
    vehicle_id,
    description,
    status: nextStatus,
    branch: canonicalizeBranchName(branch || receptionistBranch(req) || existingWo.branch || ''),
    work_order_number: normalizeWorkOrderNumber(existingWo.work_order_number, existingWo.id),
    service_advisor: (service_advisor || '').trim(),
    technician: normalizedTechnician,
    technician_assigned_at: nextTechnicianAssignedAt,
    time_in: normalizedTimeIn || (normalizedTechnician ? getCurrentTimeHHMM() : ''),
    time_out: (time_out || '').trim(),
    ...mergeWorkOrderMask(req.body, selectedCustomer, selectedVehicle),
  });
  await saveTransactionRecord(req.params.id, 'edited');
  res.redirect('/work-orders');
});

router.get('/:id/service', async (req, res) => {
  const wo = await store.getById('work_orders', req.params.id);
  if (!wo) return res.redirect('/work-orders');
  const customer = await store.getById('customers', wo.customer_id);
  const vehicle = await store.getById('vehicles', wo.vehicle_id);
  const parts_inventory = await store.getAll('parts_inventory');
  const parts_catalog = buildPartsCatalog(parts_inventory);
  const vehicleCatalog = await loadVehicleTypeCatalog();
  const service_vehicle_type = resolveWorkOrderVehicleType(wo, vehicle, vehicleCatalog);
  const labor_price_matrix = await loadLaborPriceMatrix();
  const technicianUpdates = await getWorkOrderTechnicianUpdates(wo.id);
  res.render('workorders/service', {
    wo,
    customer,
    vehicle,
    service_vehicle_type,
    labor_price_matrix,
    parts_catalog,
    technicianUpdates,
    communicationOk: req.query.communicationOk || '',
    communicationError: req.query.communicationError || '',
    normalizeRoleLabel,
    inventoryError: req.query.inventoryError || '',
  });
});

router.post('/:id/technician-update', async (req, res) => {
  const wo = await store.getById('work_orders', req.params.id);
  if (!wo) return res.redirect('/work-orders');

  const message = normalizeText(req.body.message);
  const returnTo = String(req.body.return_to || 'edit').trim().toLowerCase() === 'service' ? 'service' : 'edit';

  if (!message) {
    return res.redirect(`/work-orders/${wo.id}/${returnTo}?communicationError=Message%20is%20required.`);
  }

  const sender = (req.session && req.session.user) ? req.session.user : {};
  await store.create('technician_updates', {
    work_order_id: wo.id,
    sender_role: String(sender.role || 'service_receptionist').trim().toLowerCase() || 'service_receptionist',
    sender_username: String(sender.username || '').trim(),
    technician_name: String(wo.technician || '').trim(),
    status_flags: {
      on_break: false,
      waiting_parts: false,
    },
    message,
  });

  return res.redirect(`/work-orders/${wo.id}/${returnTo}?communicationOk=Update%20sent%20to%20technician.`);
});

router.post('/:id/service', async (req, res) => {
  const existingWo = await store.getById('work_orders', req.params.id);
  if (!existingWo) return res.redirect('/work-orders');
  if (isClosedWorkOrder(existingWo)) {
    return res.redirect(`/work-orders/${req.params.id}/edit?lockedError=Work%20Order%20is%20closed%20and%20can%20no%20longer%20be%20edited.`);
  }

  const service_items = Array.isArray(req.body.service_items)
    ? req.body.service_items
    : Object.values(req.body.service_items || {});

  const normalized = service_items.map(item => ({
    description: item.description || '',
    reason: item.reason || item.service_type || '',
    labor_price: Number(item.labor_price) || 0,
    service_qty: Math.max(1, Math.floor(Number(item.service_qty) || 1)),
    part_number: normalizePartNumber(item.part_number),
    unit: String(item.unit || '').trim(),
    parts: item.parts || item.parts_description || '',
    parts_qty: Math.max(0, Number(item.parts_qty) || 0),
    parts_price: Number(item.parts_price) || 0,
    total_price: ((Number(item.labor_price) || 0) * Math.max(1, Math.floor(Number(item.service_qty) || 1))) + (Math.max(0, Number(item.parts_qty) || 0) * (Number(item.parts_price) || 0)),
  }));

  const inventoryResult = await applyPartsInventoryAdjustments(
    existingWo.service_items || [],
    normalized,
    normalizeWorkOrderNumber(existingWo.work_order_number, existingWo.id),
    req.session && req.session.user ? req.session.user.username : ''
  );

  if (!inventoryResult.ok) {
    const errorMessage = encodeURIComponent(inventoryResult.error || 'Unable to update parts inventory.');
    return res.redirect(`/work-orders/${req.params.id}/service?inventoryError=${errorMessage}`);
  }

  await store.update('work_orders', req.params.id, {
    description: req.body.description || '',
    service_items: normalized,
  });
  await saveTransactionRecord(req.params.id, 'service-updated');
  res.redirect('/work-orders');
});

// Billing / invoice view (printable)
router.get('/:id/billing', async (req, res) => {
  const wo = await store.getById('work_orders', req.params.id);
  if (!wo) return res.redirect('/work-orders');
  const customers = await store.getAll('customers');
  const vehicles = await store.getAll('vehicles');
  const customer = customers.find(c => c.id === wo.customer_id) || {};
  const vehicle = vehicles.find(v => v.id === wo.vehicle_id) || {};
  const invoice = buildBillingInvoice(wo, customer, vehicle);
  const phoneDigits = normalizeText(wo.telephone_number || customer.phone).replace(/\D/g, '');
  const viberNumber = phoneDigits.startsWith('63')
    ? `+${phoneDigits}`
    : (phoneDigits.startsWith('0') ? `+63${phoneDigits.slice(1)}` : (phoneDigits ? `+63${phoneDigits}` : ''));
  const customerEmail = normalizeText(customer.email);

  res.render('workorders/billing', {
    wo,
    customer,
    vehicle,
    items: invoice.items,
    labor_total: invoice.labor_total,
    parts_total: invoice.parts_total,
    subtotal: invoice.subtotal,
    tax: invoice.tax,
    total: invoice.total,
    invoiceLines: invoice.invoiceLines,
    seller: invoice.seller,
    invoiceNumber: invoice.invoiceNumber,
    invoiceDate: invoice.invoiceDate,
    viberNumber,
    customerEmail,
    finalAction: normalizeText(req.query.finalAction).toLowerCase(),
    contactError: normalizeText(req.query.contactError),
    pdfSaved: normalizeText(req.query.pdfSaved),
    pdfError: normalizeText(req.query.pdfError),
    warrantyNote: BILLING_WARRANTY_NOTE,
    autoPrint: req.query.autoPrint === '1',
  });
});

router.post('/:id/billing/save-pdf', async (req, res) => {
  const wo = await store.getById('work_orders', req.params.id);
  if (!wo) return res.redirect('/work-orders');
  const customer = wo.customer_id ? (await store.getById('customers', wo.customer_id)) || {} : {};
  const vehicle = wo.vehicle_id ? (await store.getById('vehicles', wo.vehicle_id)) || {} : {};
  const saved = saveInvoicePdfCopy(buildBillingInvoice(wo, customer, vehicle));
  const query = saved.ok
    ? `pdfSaved=${encodeURIComponent(saved.fileName)}`
    : `pdfError=${encodeURIComponent(saved.error || 'Unable to save billing PDF.')}`;
  return res.redirect(`/work-orders/${req.params.id}/billing?${query}`);
});

router.post('/:id/billing/final-print', async (req, res) => {
  const wo = await store.getById('work_orders', req.params.id);
  if (!wo) return res.redirect('/work-orders');
  const requestedAction = normalizeText(req.body.next_action).toLowerCase();
  const nextAction = ['print', 'viber', 'email'].includes(requestedAction) ? requestedAction : 'print';
  const customer = wo.customer_id ? (await store.getById('customers', wo.customer_id)) || {} : {};
  if (nextAction === 'viber' && !normalizeText(wo.telephone_number || customer.phone)) {
    return res.redirect(`/work-orders/${req.params.id}/billing?contactError=${encodeURIComponent('Customer phone number is required for Viber.')}`);
  }
  if (nextAction === 'email' && !normalizeText(customer.email)) {
    return res.redirect(`/work-orders/${req.params.id}/billing?contactError=${encodeURIComponent('Customer email address is required.')}`);
  }

  const partsIndex = buildPartsCostIndex(await store.getAll('parts_inventory'));
  const finance = financeFieldsFromSnapshot(computeInvoiceEconomics(wo, partsIndex), {
    paymentMethod: normalizeText(req.body.paymentMethod || req.body.payment_method),
    paymentStatus: PAYMENT_STATUS.UNPAID,
  });
  const updated = {
    status: 'closed',
    invoice_number: normalizeText(wo.invoice_number) || normalizeWorkOrderNumber(wo.work_order_number, wo.id),
    invoice_date: normalizeText(wo.invoice_date) || new Date().toISOString(),
    ...finance,
  };

  if (!normalizeText(wo.time_out)) {
    updated.time_out = getCurrentTimeHHMM();
  }

  await store.update('work_orders', req.params.id, updated);
  const closed = Object.assign({}, wo, updated);
  const vehicle = closed.vehicle_id ? (await store.getById('vehicles', closed.vehicle_id)) || {} : {};
  const saved = saveInvoicePdfCopy(buildBillingInvoice(closed, customer, vehicle));
  await saveTransactionRecord(req.params.id, `billing-${nextAction}`, req.session && req.session.user ? req.session.user : {});
  const savedQuery = saved.ok
    ? `&pdfSaved=${encodeURIComponent(saved.fileName)}`
    : `&pdfError=${encodeURIComponent(saved.error || 'Unable to save billing PDF.')}`;
  res.redirect(`/work-orders/${req.params.id}/billing?finalAction=${nextAction}${savedQuery}`);
});

router.get('/:id/technician-print', async (req, res) => {
  const wo = await store.getById('work_orders', req.params.id);
  if (!wo) return res.redirect('/work-orders');

  if (!normalizeText(wo.technician)) {
    return res.redirect(`/work-orders/${wo.id}/edit?printError=Technician%20is%20required%20before%20printing.`);
  }

  const customers = await store.getAll('customers');
  const vehicles = await store.getAll('vehicles');
  const customer = customers.find(c => c.id === wo.customer_id) || {};
  const vehicle = vehicles.find(v => v.id === wo.vehicle_id) || {};
  const items = wo.service_items || [];

  res.render('workorders/technician_print', { wo, customer, vehicle, items });
});

async function removeWorkOrder(id, audit = {}) {
  const workOrder = await store.getById('work_orders', id);
  if (!workOrder) return false;
  await store.update('work_orders', id, { status: 'deleted' });
  await saveTransactionRecord(id, 'deleted', audit);
  await store.remove('work_orders', id);
  return true;
}

router.post('/:id/delete', async (req, res) => {
  await removeWorkOrder(req.params.id, req.session && req.session.user ? req.session.user : {});
  res.redirect('/work-orders');
});

router.removeWorkOrder = removeWorkOrder;
module.exports = router;
