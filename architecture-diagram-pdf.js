const fs = require('fs');

const W = 792, H = 612;
const cmds = [];
const esc = s => String(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
const text = (x, y, s, size = 9, bold = false) => {
  cmds.push(`0.05 0.07 0.10 rg BT /${bold ? 'F2' : 'F1'} ${size} Tf ${x} ${y} Td (${esc(s)}) Tj ET`);
};
const box = (x, y, w, h, label, fill = '0.93 0.95 0.98') => {
  cmds.push(`${fill} rg ${x} ${y} ${w} ${h} re f 0.18 0.25 0.35 RG 1 w ${x} ${y} ${w} ${h} re S`);
  const lines = label.split('\n');
  lines.forEach((line, i) => text(x + 7, y + h - 16 - i * 12, line, 8, i === 0));
};
const line = (x1, y1, x2, y2) => cmds.push(`0.18 0.25 0.35 RG 1 w ${x1} ${y1} m ${x2} ${y2} l S`);
const arrow = (x1, y1, x2, y2) => { line(x1,y1,x2,y2); cmds.push(`${x2} ${y2} m ${x2-5} ${y2+3} l ${x2-5} ${y2-3} l h f`); };

text(36, 575, 'A&E Auto Service DMS — Architecture Diagram', 16, true);
text(36, 558, 'Express.js / EJS application with role-based portals and SQLite/JSON persistence', 9);

box(36, 490, 130, 44, 'Users by role\nGM • Admin • HR • Service • Parts • Finance');
box(205, 490, 120, 44, 'Web Browser');
box(365, 490, 160, 44, 'Express.js Application\napp.js');
box(565, 490, 190, 44, 'Security Middleware\nHelmet • Sessions • Rate limiting');
arrow(166,512,205,512); arrow(325,512,365,512); arrow(525,512,565,512);

box(36, 410, 150, 44, 'Authentication & RBAC\nroutes/auth.js');
box(216, 410, 150, 44, 'Portals & Dashboards\nlib/portals.js');
box(396, 410, 150, 44, 'Feature Routers\nroutes/*.js');
box(576, 410, 179, 44, 'EJS Views & Static Assets\nviews/ • public/');
arrow(445,490,111,454); arrow(445,490,291,454); arrow(445,490,471,454); arrow(445,490,665,454);

box(36, 315, 150, 52, 'Operations\nCustomers • Vehicles\nWork Orders • Technicians', '0.91 0.97 0.91');
box(216, 315, 150, 52, 'Parts & Inventory\nRequests • Purchasing\nReceiving • Transfers', '0.91 0.97 0.91');
box(396, 315, 150, 52, 'Finance & Billing\nInvoices • Payments\nLedger • Expenses', '0.91 0.97 0.91');
box(576, 315, 179, 52, 'HR • Reports • Admin\nEmployees • KPIs • Approvals\nAudit & branch controls', '0.91 0.97 0.91');
arrow(291,410,111,367); arrow(291,410,291,367); arrow(291,410,471,367); arrow(291,410,665,367);

box(36, 220, 330, 50, 'Domain Services — lib/*.js\nFinance, parts, purchase orders, reports, branches, technician activity, approvals');
box(396, 220, 359, 50, 'Data Store Abstraction — data/store.js\nCentral read/write interface used by routes, services, and maintenance jobs');
arrow(111,315,201,270); arrow(291,315,201,270); arrow(471,315,201,270); arrow(665,315,201,270); arrow(366,245,396,245);

box(36, 115, 330, 54, 'SQLite (preferred)\nshop.sqlite • WAL • store_docs table', '0.98 0.94 0.84');
box(396, 115, 359, 54, 'JSON fallback\ndata-snapshot.json\nUsed when SQLite driver is unavailable', '0.98 0.94 0.84');
arrow(201,220,201,169); arrow(201,220,575,169);

box(36, 36, 330, 42, 'Maintenance & Data Jobs\nscripts/*.js • migrations • imports • backups');
box(396, 36, 359, 42, 'Deployment / Sync\nRender sync • seed data • scheduled operations');
arrow(201,115,201,78); arrow(575,78,575,115);

const content = cmds.join('\n');
const objects = [
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 792 612] /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>',
  `<< /Length ${Buffer.byteLength(content) + 1} >>\nstream\n${content}\nendstream`,
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>'
];
let pdf = '%PDF-1.4\n'; const offsets = [0];
objects.forEach((obj, i) => { offsets[i+1] = Buffer.byteLength(pdf); pdf += `${i+1} 0 obj\n${obj}\nendobj\n`; });
const xref = Buffer.byteLength(pdf); pdf += `xref\n0 ${objects.length+1}\n0000000000 65535 f \n`; for (let i=1;i<offsets.length;i++) pdf += `${String(offsets[i]).padStart(10,'0')} 00000 n \n`;
pdf += `trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
fs.writeFileSync('architecture-diagram-landscape.pdf', pdf);
