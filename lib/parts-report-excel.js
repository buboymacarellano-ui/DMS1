const ExcelJS = require('exceljs');

async function buildReportExcel(report) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'A&E Auto Service DMS';
  const usedNames = new Set();
  (report.tables || []).forEach((table, index) => {
    const baseName = String(table.heading || report.title || `Report ${index + 1}`)
      .replace(/[*?:\\/\[\]\x00-\x1f]/g, ' ')
      .replace(/^'+|'+$/g, '').trim().slice(0, 31) || `Report ${index + 1}`;
    let name = baseName;
    let suffix = 1;
    while (usedNames.has(name.toLowerCase())) {
      const ending = ` (${suffix++})`;
      name = baseName.slice(0, 31 - ending.length) + ending;
    }
    usedNames.add(name.toLowerCase());
    const sheet = workbook.addWorksheet(name);
    sheet.addRow([report.title]);
    sheet.addRow([report.subtitle || '']);
    sheet.addRow(['Generated', report.generatedAt || '']);
    (report.meta || []).forEach((item) => sheet.addRow([item.label, item.value ?? '']));
    sheet.addRow([]);
    const header = sheet.addRow(['#', ...table.columns.map((column) => column.header)]);
    header.font = { bold: true };
    sheet.views = [{ state: 'frozen', ySplit: header.number }];
    sheet.autoFilter = {
      from: { row: header.number, column: 1 },
      to: { row: header.number, column: table.columns.length + 1 },
    };
    table.rows.forEach((row, rowIndex) => {
      const cells = table.columns.map((column) => {
        const value = row[column.key];
        if (value == null || value === '') return '';
        if (column.numeric && Number.isFinite(Number(value))) return Number(value);
        return String(value);
      });
      const excelRow = sheet.addRow([rowIndex + 1, ...cells]);
      table.columns.forEach((column, columnIndex) => {
        if (column.money) excelRow.getCell(columnIndex + 2).numFmt = '#,##0.00';
      });
    });
    sheet.getColumn(1).width = 8;
    table.columns.forEach((column, columnIndex) => {
      sheet.getColumn(columnIndex + 2).width = Math.min(40, Math.max(16, column.header.length + 2));
    });
    sheet.getRow(1).font = { bold: true, size: 16 };
  });
  return workbook.xlsx.writeBuffer();
}

module.exports = { buildReportExcel };
