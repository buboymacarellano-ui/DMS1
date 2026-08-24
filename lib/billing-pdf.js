const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const BILLING_WARRANTY_NOTE = 'All services itemized above carry a 1-Month service warranty limited strictly to the specific parts replaced and labor executed herein. This warranty is void if the vehicle is subjected to misuse, neglect, racing, commercial operations, or alterations performed outside our facility. We are not liable for incidental, consequential, or pre-existing vehicle damages. Original invoice required for all claims.';

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function money(value) {
  return `PHP ${toNumber(value).toFixed(2)}`;
}

function sanitizeFileBase(name) {
  const cleaned = String(name || 'Customer')
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '');
  return (cleaned || 'Customer').slice(0, 120);
}

function resolveDocumentsDir() {
  try {
    const folder = execFileSync(
      'powershell.exe',
      ['-NoProfile', '-Command', '[Environment]::GetFolderPath("MyDocuments")'],
      { encoding: 'utf8', windowsHide: true, timeout: 8000 }
    ).trim();
    if (folder && fs.existsSync(folder)) return folder;
  } catch (_) {
    // Fall through to known Windows locations.
  }

  const home = process.env.USERPROFILE || os.homedir();
  const candidates = [
    path.join(home, 'Documents'),
    path.join(home, 'OneDrive', 'Documents'),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(dir)) return dir;
  }
  const fallback = path.join(home, 'Documents');
  fs.mkdirSync(fallback, { recursive: true });
  return fallback;
}

function nextCustomerPdfPath(customerName, documentsDir) {
  const folder = documentsDir || resolveDocumentsDir();
  const base = sanitizeFileBase(customerName);
  const first = path.join(folder, `${base}.pdf`);
  if (!fs.existsSync(first)) return first;

  let n = 1;
  while (n < 1000) {
    const candidate = path.join(folder, `${base} +${n}.pdf`);
    if (!fs.existsSync(candidate)) return candidate;
    n += 1;
  }
  return path.join(folder, `${base} +${Date.now()}.pdf`);
}

function pdfEscape(text) {
  return String(text || '')
    .replace(/₱/g, 'PHP ')
    .replace(/[^\x20-\x7E]/g, (ch) => {
      const map = { '—': '-', '–': '-', '“': '"', '”': '"', '‘': "'", '’': "'", 'ñ': 'n', 'Ñ': 'N' };
      return map[ch] || ' ';
    })
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function wrapText(text, width) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  if (!words.length) return [''];
  const lines = [];
  let current = '';
  words.forEach((word) => {
    const next = current ? `${current} ${word}` : word;
    if (next.length > width) {
      if (current) lines.push(current);
      current = word;
    } else {
      current = next;
    }
  });
  if (current) lines.push(current);
  return lines;
}

function buildInvoiceCommands(invoice) {
  const commands = [];
  let y = 750;

  function line(font, size, x, text) {
    commands.push(`BT /${font} ${size} Tf ${x} ${y} Td (${pdfEscape(text)}) Tj ET`);
  }

  function gap(amount) {
    y -= amount;
  }

  const seller = invoice.seller || {};
  const customer = invoice.customer || {};
  const wo = invoice.wo || {};
  const vehicle = invoice.vehicle || {};

  line('F2', 16, 48, seller.registeredName || 'A&E AUTO SERVICE GROUP INC.');
  gap(16);
  line('F1', 10, 48, seller.businessName || 'A&E Auto Service Group Inc.');
  gap(13);
  line('F1', 9, 48, seller.address || '');
  gap(12);
  line('F1', 9, 48, `VAT REG TIN: ${seller.tin || ''}${seller.branchCode ? ` | Branch: ${seller.branchCode}` : ''}`);
  gap(12);
  line('F1', 9, 48, `Tel: ${seller.phone || ''}`);

  y = 750;
  line('F2', 16, 360, 'SALES INVOICE');
  gap(18);
  line('F1', 10, 360, `Invoice No.: ${invoice.invoiceNumber || ''}`);
  gap(13);
  line('F1', 10, 360, `Date: ${invoice.invoiceDateLabel || ''}`);
  gap(13);
  line('F1', 10, 360, `Work Order: ${wo.work_order_number || wo.id || ''}`);

  y = 640;
  commands.push('0.2 w 48 648 m 564 648 l S');
  line('F2', 11, 48, 'Sold To');
  gap(14);
  line('F1', 10, 48, customer.name || 'Customer');
  gap(12);
  wrapText(`Address: ${customer.address || '-'}`, 48).forEach((row) => {
    line('F1', 9, 48, row);
    gap(11);
  });
  line('F1', 9, 48, `Phone: ${wo.telephone_number || customer.phone || '-'}`);

  y = 640;
  line('F2', 11, 330, 'Vehicle / Service');
  gap(14);
  line('F1', 10, 330, `${wo.car_brand || vehicle.make || '-'} ${wo.car_model || vehicle.model || ''}`);
  gap(12);
  line('F1', 9, 330, `Plate: ${wo.plate_number || vehicle.license_plate || '-'}`);
  gap(11);
  line('F1', 9, 330, `Year: ${wo.car_year || vehicle.year || '-'}`);
  gap(11);
  line('F1', 9, 330, `SR: ${wo.service_advisor || '-'}`);

  y = 500;
  commands.push('0.2 w 48 508 m 564 508 l S');
  line('F2', 9, 48, 'Qty');
  line('F2', 9, 88, 'Unit');
  line('F2', 9, 150, 'Description');
  line('F2', 9, 420, 'Unit Price');
  line('F2', 9, 510, 'Amount');
  gap(16);

  const lines = Array.isArray(invoice.invoiceLines) ? invoice.invoiceLines : [];
  if (!lines.length) {
    line('F1', 9, 150, 'No billable service or parts lines.');
    gap(14);
  }

  lines.forEach((entry) => {
    if (y < 160) return;
    const descLines = wrapText(entry.description || '', 38);
    line('F1', 9, 48, String(entry.quantity || ''));
    line('F1', 9, 88, entry.unit || '');
    line('F1', 9, 150, descLines[0] || '');
    line('F1', 9, 420, money(entry.unitPrice));
    line('F1', 9, 510, money(entry.amount));
    gap(12);
    descLines.slice(1).forEach((row) => {
      line('F1', 8, 150, row);
      gap(11);
    });
  });

  const blockStart = Math.min(y - 8, 248);
  y = blockStart;
  commands.push('0.2 w 330 256 m 564 256 l S');
  const totals = [
    ['Labor Sales', invoice.labor_total],
    ['Parts Sales', invoice.parts_total],
    ['VATable Sales', invoice.subtotal],
    ['VAT 12%', invoice.tax],
    ['Total Amount Due', invoice.total],
  ];
  totals.forEach(([label, value], index) => {
    line(index === totals.length - 1 ? 'F2' : 'F1', 10, 330, label);
    line(index === totals.length - 1 ? 'F2' : 'F1', 10, 480, money(value));
    gap(14);
  });
  const afterTotalsY = y;

  y = blockStart;
  wrapText(BILLING_WARRANTY_NOTE, 46).forEach((row) => {
    if (y < 72) return;
    line('F1', 7, 48, row);
    gap(9);
  });

  y = Math.min(afterTotalsY, y) - 8;
  if (y < 72) y = 72;
  line('F1', 8, 48, `Prepared by: ${wo.service_advisor || ''}`);
  gap(12);
  line('F1', 8, 48, 'Saved automatically to this PC Documents folder.');

  return commands.join('\n');
}

function buildPdfBuffer(invoice) {
  const stream = buildInvoiceCommands(invoice);
  const objects = [];
  const add = (body) => {
    objects.push(body);
    return objects.length;
  };

  const font1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const font2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');
  const contents = add(`<< /Length ${Buffer.byteLength(stream, 'utf8')} >>\nstream\n${stream}\nendstream`);
  const page = add(`<< /Type /Page /Parent 0 0 R /MediaBox [0 0 612 792] /Contents ${contents} 0 R /Resources << /Font << /F1 ${font1} 0 R /F2 ${font2} 0 R >> >> >>`);
  const pages = add(`<< /Type /Pages /Kids [${page} 0 R] /Count 1 >>`);
  objects[page - 1] = objects[page - 1].replace('/Parent 0 0 R', `/Parent ${pages} 0 R`);
  const catalog = add(`<< /Type /Catalog /Pages ${pages} 0 R >>`);

  let offset = 0;
  const chunks = ['%PDF-1.4\n'];
  offset = Buffer.byteLength(chunks[0], 'utf8');
  const xref = [0];
  objects.forEach((body, index) => {
    xref[index + 1] = offset;
    const object = `${index + 1} 0 obj\n${body}\nendobj\n`;
    chunks.push(object);
    offset += Buffer.byteLength(object, 'utf8');
  });

  const xrefStart = offset;
  let xrefTable = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i += 1) {
    xrefTable += `${String(xref[i]).padStart(10, '0')} 00000 n \n`;
  }
  chunks.push(xrefTable);
  chunks.push(`trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xrefStart}\n%%EOF`);
  return Buffer.concat(chunks.map((part) => Buffer.from(part, 'utf8')));
}

function saveBillingPdf(invoice) {
  const customerName = (invoice && invoice.customer && invoice.customer.name) || 'Customer';
  const documentsDir = resolveDocumentsDir();
  const filePath = nextCustomerPdfPath(customerName, documentsDir);
  fs.writeFileSync(filePath, buildPdfBuffer(invoice));
  return {
    ok: true,
    filePath,
    fileName: path.basename(filePath),
    documentsDir,
    customerName,
  };
}

module.exports = {
  BILLING_WARRANTY_NOTE,
  sanitizeFileBase,
  resolveDocumentsDir,
  nextCustomerPdfPath,
  saveBillingPdf,
  buildPdfBuffer,
};
