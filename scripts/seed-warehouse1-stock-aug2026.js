/**
 * Seeds 50 new Warehouse 1 car parts as "stock" transactions.
 * Dates: 2026-08-01 through 2026-08-23. Qty: 10 each.
 */
const store = require('../data/store');
const inventory = require('../lib/parts-inventory-controller');
const { allocatePartsTransactionNumber } = require('../lib/parts-transaction-number');

const LOCATION = 'Warehouse 1';
const QTY = 10;
const EDITOR = 'SEED-WAREHOUSE1';
const SEED_TAG = 'W1-AUG26';

const PARTS = [
  { part_number: 'W1-90915-YZZF1', part_name: 'Engine Oil Filter Cartridge', generic: 'Oil Filter', supplier: 'Toyota Genuine Parts', unit: 'pc', cost_price: 285.00, markup: 32 },
  { part_number: 'W1-17801-0T050', part_name: 'Engine Air Filter Element', generic: 'Air Filter', supplier: 'Mann+Hummel', unit: 'pc', cost_price: 640.00, markup: 28 },
  { part_number: 'W1-87139-YZZ08', part_name: 'Cabin Pollen Filter', generic: 'Cabin Filter', supplier: 'Denso Sales Philippines', unit: 'pc', cost_price: 475.00, markup: 30 },
  { part_number: 'W1-23300-0L090', part_name: 'Fuel Filter Assembly', generic: 'Fuel Filter', supplier: 'Bosch Automotive PH', unit: 'pc', cost_price: 1280.00, markup: 26 },
  { part_number: 'W1-90919-01253', part_name: 'Iridium Spark Plug Set', generic: 'Ignition', supplier: 'NGK Spark Plugs', unit: 'set', cost_price: 1860.00, markup: 35 },
  { part_number: 'W1-90916-03075', part_name: 'Serpentine Drive Belt', generic: 'Belt', supplier: 'Gates Industrial', unit: 'pc', cost_price: 980.00, markup: 24 },
  { part_number: 'W1-13568-09071', part_name: 'Timing Belt Kit', generic: 'Belt', supplier: 'Aisin Philippines', unit: 'set', cost_price: 4250.00, markup: 22 },
  { part_number: 'W1-13503-0T020', part_name: 'Timing Chain Tensioner', generic: 'Engine', supplier: 'Toyota Genuine Parts', unit: 'pc', cost_price: 2150.00, markup: 25 },
  { part_number: 'W1-16100-0T060', part_name: 'Water Pump Assembly', generic: 'Cooling', supplier: 'Aisin Philippines', unit: 'pc', cost_price: 3480.00, markup: 27 },
  { part_number: 'W1-16400-31030', part_name: 'Radiator Assembly', generic: 'Cooling', supplier: 'Denso Sales Philippines', unit: 'pc', cost_price: 6890.00, markup: 20 },
  { part_number: 'W1-16571-0T010', part_name: 'Radiator Upper Hose', generic: 'Cooling', supplier: 'Gates Industrial', unit: 'pc', cost_price: 420.00, markup: 38 },
  { part_number: 'W1-16572-0T020', part_name: 'Radiator Lower Hose', generic: 'Cooling', supplier: 'Gates Industrial', unit: 'pc', cost_price: 395.00, markup: 38 },
  { part_number: 'W1-88320-0T040', part_name: 'A/C Compressor', generic: 'A/C', supplier: 'Denso Sales Philippines', unit: 'pc', cost_price: 11250.00, markup: 18 },
  { part_number: 'W1-87110-0T010', part_name: 'A/C Condenser', generic: 'A/C', supplier: 'Valeo Philippines', unit: 'pc', cost_price: 5420.00, markup: 21 },
  { part_number: 'W1-04465-02340', part_name: 'Front Brake Pad Set', generic: 'Brakes', supplier: 'Bosch Automotive PH', unit: 'set', cost_price: 1680.00, markup: 33 },
  { part_number: 'W1-04466-0K080', part_name: 'Rear Brake Pad Set', generic: 'Brakes', supplier: 'Bosch Automotive PH', unit: 'set', cost_price: 1420.00, markup: 33 },
  { part_number: 'W1-43512-0K050', part_name: 'Front Brake Disc Rotor', generic: 'Brakes', supplier: 'Aisin Philippines', unit: 'pc', cost_price: 2350.00, markup: 26 },
  { part_number: 'W1-42431-0K090', part_name: 'Rear Brake Disc Rotor', generic: 'Brakes', supplier: 'Aisin Philippines', unit: 'pc', cost_price: 1980.00, markup: 26 },
  { part_number: 'W1-47730-0K060', part_name: 'Front Brake Caliper', generic: 'Brakes', supplier: 'Toyota Genuine Parts', unit: 'pc', cost_price: 4150.00, markup: 23 },
  { part_number: 'W1-04945-0K010', part_name: 'Brake Master Cylinder', generic: 'Brakes', supplier: 'Aisin Philippines', unit: 'pc', cost_price: 2875.00, markup: 24 },
  { part_number: 'W1-04495-0K010', part_name: 'Brake Fluid DOT 4 500ml', generic: 'Fluids', supplier: 'Castrol Philippines', unit: 'bottle', cost_price: 185.00, markup: 42 },
  { part_number: 'W1-08880-10705', part_name: 'Engine Oil 5W-30 4L', generic: 'Fluids', supplier: 'Petron Corporation', unit: 'bottle', cost_price: 980.00, markup: 30 },
  { part_number: 'W1-08886-01605', part_name: 'ATF WS Automatic Transmission Fluid 4L', generic: 'Fluids', supplier: 'Toyota Genuine Parts', unit: 'bottle', cost_price: 1450.00, markup: 28 },
  { part_number: 'W1-08816-00132', part_name: 'Coolant Premix 4L', generic: 'Fluids', supplier: 'Petron Corporation', unit: 'bottle', cost_price: 420.00, markup: 36 },
  { part_number: 'W1-08885-81001', part_name: 'Power Steering Fluid 1L', generic: 'Fluids', supplier: 'Castrol Philippines', unit: 'bottle', cost_price: 265.00, markup: 40 },
  { part_number: 'W1-48510-0K080', part_name: 'Front Shock Absorber', generic: 'Suspension', supplier: 'KYB Philippines', unit: 'pc', cost_price: 3120.00, markup: 27 },
  { part_number: 'W1-48530-0K070', part_name: 'Rear Shock Absorber', generic: 'Suspension', supplier: 'KYB Philippines', unit: 'pc', cost_price: 2780.00, markup: 27 },
  { part_number: 'W1-48609-0K040', part_name: 'Front Stabilizer Link', generic: 'Suspension', supplier: '555 Chassis Parts', unit: 'pc', cost_price: 540.00, markup: 34 },
  { part_number: 'W1-45503-0K060', part_name: 'Tie Rod End Outer', generic: 'Steering', supplier: '555 Chassis Parts', unit: 'pc', cost_price: 680.00, markup: 32 },
  { part_number: 'W1-45460-0K050', part_name: 'Steering Rack Boot Kit', generic: 'Steering', supplier: 'Gates Industrial', unit: 'set', cost_price: 390.00, markup: 41 },
  { part_number: 'W1-45046-0K080', part_name: 'Power Steering Pump', generic: 'Steering', supplier: 'Bosch Automotive PH', unit: 'pc', cost_price: 5680.00, markup: 19 },
  { part_number: 'W1-27060-0T050', part_name: 'Alternator Assembly 90A', generic: 'Electrical', supplier: 'Denso Sales Philippines', unit: 'pc', cost_price: 7450.00, markup: 18 },
  { part_number: 'W1-28100-0T070', part_name: 'Starter Motor', generic: 'Electrical', supplier: 'Denso Sales Philippines', unit: 'pc', cost_price: 6290.00, markup: 20 },
  { part_number: 'W1-28800-0T040', part_name: 'Maintenance-Free Battery 12V 65AH', generic: 'Electrical', supplier: 'Motolite Philippines', unit: 'pc', cost_price: 4850.00, markup: 22 },
  { part_number: 'W1-90980-15016', part_name: 'Wiper Blade Set 22/16', generic: 'Wipers', supplier: 'Bosch Automotive PH', unit: 'set', cost_price: 620.00, markup: 37 },
  { part_number: 'W1-85214-0K010', part_name: 'Wiper Motor Assembly', generic: 'Wipers', supplier: 'Valeo Philippines', unit: 'pc', cost_price: 2140.00, markup: 25 },
  { part_number: 'W1-81110-0K060', part_name: 'Headlamp Assembly LH', generic: 'Lighting', supplier: 'Koito Philippines', unit: 'pc', cost_price: 3980.00, markup: 23 },
  { part_number: 'W1-81150-0K060', part_name: 'Headlamp Assembly RH', generic: 'Lighting', supplier: 'Koito Philippines', unit: 'pc', cost_price: 3980.00, markup: 23 },
  { part_number: 'W1-81550-0K040', part_name: 'Tail Lamp Assembly LH', generic: 'Lighting', supplier: 'Koito Philippines', unit: 'pc', cost_price: 2460.00, markup: 24 },
  { part_number: 'W1-90080-81097', part_name: 'H4 Halogen Bulb Pair', generic: 'Lighting', supplier: 'Osram Philippines', unit: 'pair', cost_price: 310.00, markup: 45 },
  { part_number: 'W1-04428-0K010', part_name: 'Clutch Disc and Cover Kit', generic: 'Drivetrain', supplier: 'Sachs / ZF', unit: 'set', cost_price: 5120.00, markup: 21 },
  { part_number: 'W1-31230-0K050', part_name: 'Clutch Release Bearing', generic: 'Drivetrain', supplier: 'Sachs / ZF', unit: 'pc', cost_price: 860.00, markup: 29 },
  { part_number: 'W1-33401-0K080', part_name: 'CV Joint Outer Assembly', generic: 'Drivetrain', supplier: 'GKN Driveline', unit: 'pc', cost_price: 2680.00, markup: 26 },
  { part_number: 'W1-42311-0K040', part_name: 'Rear Wheel Hub Bearing', generic: 'Drivetrain', supplier: 'NSK Bearings PH', unit: 'pc', cost_price: 1890.00, markup: 28 },
  { part_number: 'W1-90311-40031', part_name: 'Front Wheel Hub Bearing', generic: 'Drivetrain', supplier: 'NSK Bearings PH', unit: 'pc', cost_price: 1760.00, markup: 28 },
  { part_number: 'W1-90947-02476', part_name: 'Oxygen Sensor Upstream', generic: 'Emissions', supplier: 'NGK Spark Plugs', unit: 'pc', cost_price: 3240.00, markup: 24 },
  { part_number: 'W1-89465-0K050', part_name: 'Mass Air Flow Sensor', generic: 'Sensors', supplier: 'Denso Sales Philippines', unit: 'pc', cost_price: 4120.00, markup: 22 },
  { part_number: 'W1-89422-0K010', part_name: 'Engine Coolant Temperature Sensor', generic: 'Sensors', supplier: 'Bosch Automotive PH', unit: 'pc', cost_price: 540.00, markup: 39 },
  { part_number: 'W1-23250-0T070', part_name: 'Fuel Injector Set of 4', generic: 'Fuel', supplier: 'Denso Sales Philippines', unit: 'set', cost_price: 6780.00, markup: 20 },
  { part_number: 'W1-77020-0K090', part_name: 'Fuel Pump Assembly In-Tank', generic: 'Fuel', supplier: 'Aisin Philippines', unit: 'pc', cost_price: 5340.00, markup: 21 },
];

function retailPrice(cost, markup) {
  return Number((cost + cost * (markup / 100)).toFixed(2));
}

function dateForIndex(index) {
  const start = new Date(2026, 7, 1);
  const end = new Date(2026, 7, 23);
  const span = Math.round((end.getTime() - start.getTime()) / 86400000);
  const dayOffset = Math.floor((index * span) / (PARTS.length - 1));
  const dt = new Date(start);
  dt.setDate(start.getDate() + dayOffset);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const d = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function isoOnDate(dateKey, hour, minute) {
  const hh = String(hour).padStart(2, '0');
  const mm = String(minute).padStart(2, '0');
  return `${dateKey}T${hh}:${mm}:00+08:00`;
}

function genId(index) {
  return `w1aug26-${String(index + 1).padStart(3, '0')}-${SEED_TAG.toLowerCase()}`;
}

async function main() {
  const data = await store.getRawData();
  if (!Array.isArray(data.parts_inventory)) data.parts_inventory = [];
  if (!Array.isArray(data.transactions)) data.transactions = [];

  const existingKeys = new Set(
    [...data.parts_inventory, ...data.transactions]
      .map((row) => String(row && row.part_number || '').trim().toUpperCase())
      .filter(Boolean)
  );

  let created = 0;
  let skipped = 0;

  PARTS.forEach((part, index) => {
    const partNumber = part.part_number;
    if (existingKeys.has(partNumber.toUpperCase())) {
      skipped += 1;
      return;
    }

    const dateKey = dateForIndex(index);
    const record = {
      id: genId(index),
      created_at: isoOnDate(dateKey, 8 + (index % 9), (index * 7) % 60),
      date: dateKey,
      transaction_date: dateKey,
      transaction_number: allocatePartsTransactionNumber(data, new Date(`${dateKey}T12:00:00+08:00`)),
      transaction_type: 'stock',
      present_location: LOCATION,
      branch: LOCATION,
      editor: EDITOR,
      part_number: partNumber,
      part_name: part.part_name,
      generic: part.generic,
      supplier: part.supplier,
      unit: part.unit,
      qty: QTY,
      cost_price: part.cost_price,
      markup: part.markup,
      retail_price: retailPrice(part.cost_price, part.markup),
      sold_to: '',
      seed_batch: SEED_TAG,
    };

    data.parts_inventory.push(record);
    inventory.rememberTransaction(data, record);
    existingKeys.add(partNumber.toUpperCase());
    created += 1;
  });

  if (created) {
    await store.replaceData(data);
  }

  const warehouseRows = data.parts_inventory.filter((row) => (
    String(row.present_location || '') === LOCATION && String(row.seed_batch || '') === SEED_TAG
  ));

  console.log(JSON.stringify({
    created,
    skipped,
    total_seeded: warehouseRows.length,
    location: LOCATION,
    qty_each: QTY,
    type: 'stock',
    date_span: '2026-08-01 to 2026-08-23',
    suppliers: [...new Set(warehouseRows.map((row) => row.supplier))].length,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
