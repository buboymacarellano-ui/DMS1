const express = require('express');
const store = require('../data/store');
const { buildGeneratedReport } = require('../lib/parts-reports');
const { filterDataToLocation, resolveFrontlinePartsView } = require('../lib/parts-location-scope');
const { canonicalizeBranchName } = require('../lib/branches');

const router = express.Router();

function actorBranchFromSession(user, employees) {
  const sessionBranch = canonicalizeBranchName(String(user && user.branch || '').trim());
  if (sessionBranch && sessionBranch.toUpperCase() !== 'ALL') return sessionBranch;
  return '';
}

router.get('/generate', async (req, res) => {
  const data = await store.getRawData();
  const user = (req.session && req.session.user) || {};
  const view = resolveFrontlinePartsView(user, req.query, actorBranchFromSession(user, data.employees));
  const scopedData = view.isFrontline ? filterDataToLocation(data, view.location) : data;
  const report = buildGeneratedReport(scopedData, req.query);
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
  return res.render('reports/generate', { report });
});

module.exports = router;
