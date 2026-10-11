const express = require('express');
const store = require('../data/store');
const { buildGeneratedReport } = require('../lib/parts-reports');
const { filterDataToLocation, resolveFrontlinePartsView } = require('../lib/parts-location-scope');
const { canonicalizeBranchName } = require('../lib/branches');
const { buildReportExcel } = require('../lib/parts-report-excel');

const router = express.Router();

function actorBranchFromSession(user, employees) {
  const sessionBranch = canonicalizeBranchName(String(user && user.branch || '').trim());
  if (sessionBranch && sessionBranch.toUpperCase() !== 'ALL') return sessionBranch;
  return '';
}

router.get('/generate', async (req, res, next) => {
  const data = await store.getRawData();
  const user = (req.session && req.session.user) || {};
  const view = resolveFrontlinePartsView(user, req.query, actorBranchFromSession(user, data.employees));
  const scopedData = view.isFrontline ? filterDataToLocation(data, view.location) : data;
  const report = buildGeneratedReport(scopedData, req.query, {
    location: view.isFrontline ? view.location : '',
  });
  if (report && report.ok && report.format === 'csv' && report.csv != null) {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    const filename = String(report.filename || 'parts-database.csv').replace(/[^a-zA-Z0-9._-]/g, '_');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.status(200).send(report.csv);
  }
  if (!report.ok) {
    return res.status(400).render('reports/generate', {
      report: {
        ok: false,
        title: 'Report Error',
        generatedAt: new Date().toISOString(),
        subtitle: report.error,
        tables: [],
        error: report.error,
      },
    });
  }
  if (req.query.format === 'xlsx') {
    try {
      const buffer = await buildReportExcel(report);
      const filename = `parts-${report.type}-${report.generatedAt.slice(0, 10)}.xlsx`
        .replace(/[^a-zA-Z0-9._-]/g, '_');
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.status(200).send(Buffer.from(buffer));
    } catch (error) {
      return next(error);
    }
  }
  const exportQuery = new URLSearchParams();
  Object.entries(req.query).forEach(([key, value]) => {
    if (typeof value === 'string') exportQuery.set(key, value);
  });
  exportQuery.set('format', 'xlsx');
  report.excelUrl = `/api/reports/generate?${exportQuery.toString()}`;
  return res.render('reports/generate', { report });
});

module.exports = router;
