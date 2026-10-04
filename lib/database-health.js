/**
 * Database Health Monitoring System
 * Tracks SQLite database status, performance, and operational metrics
 */

const store = require('../data/store');

/**
 * Check current database health
 * @returns {Promise<Object>} Health metrics
 */
async function checkDatabaseHealth() {
  try {
    const now = new Date();
    const timestamp = now.toISOString();
    
    // Get database connection info
    const engineName = store.getEngineName ? store.getEngineName() : 'sqlite';
    const sqlitePath = store.getSqlitePath ? store.getSqlitePath() : 'unknown';
    const snapshotPath = store.getSnapshotPath ? store.getSnapshotPath() : 'unknown';
    
    // Try to get all collections to verify database is responsive
    let collectionsStatus = [];
    let isHealthy = true;
    let errorMessage = '';
    
    const collections = [
      'work_orders',
      'customers',
      'vehicles',
      'employees',
      'parts_inventory',
      'transaction_records',
      'users',
    ];
    
    const collectionStats = {};
    
    try {
      for (const collection of collections) {
        try {
          const data = await store.getAll(collection);
          const count = Array.isArray(data) ? data.length : 0;
          collectionStats[collection] = {
            status: 'ok',
            recordCount: count,
            lastUpdated: now.toISOString(),
          };
        } catch (err) {
          collectionStats[collection] = {
            status: 'error',
            recordCount: 0,
            error: err.message,
          };
          isHealthy = false;
        }
      }
    } catch (err) {
      isHealthy = false;
      errorMessage = err.message;
    }
    
    // Calculate collection health percentage
    const totalCollections = Object.keys(collectionStats).length;
    const healthyCollections = Object.values(collectionStats).filter(c => c.status === 'ok').length;
    const healthPercentage = totalCollections > 0 ? Math.round((healthyCollections / totalCollections) * 100) : 0;
    
    return {
      status: isHealthy ? 'healthy' : 'degraded',
      timestamp,
      engine: engineName,
      paths: {
        database: sqlitePath,
        snapshot: snapshotPath,
      },
      health: {
        percentage: healthPercentage,
        totalCollections,
        healthyCollections,
        degradedCollections: totalCollections - healthyCollections,
      },
      collections: collectionStats,
      errorMessage: errorMessage || null,
      responseTimeMs: Math.round((new Date().getTime() - now.getTime())),
    };
  } catch (error) {
    return {
      status: 'error',
      timestamp: new Date().toISOString(),
      error: error.message,
      health: {
        percentage: 0,
      },
    };
  }
}

/**
 * Get health status summary (condensed)
 * @returns {Promise<Object>} Summary status
 */
async function getHealthSummary() {
  const health = await checkDatabaseHealth();
  return {
    status: health.status,
    healthPercentage: health.health.percentage,
    timestamp: health.timestamp,
    errorMessage: health.errorMessage,
  };
}

/**
 * Format health status for dashboard display
 * @param {Object} health Health metrics
 * @returns {Object} Formatted display data
 */
function formatHealthDisplay(health) {
  const statusCode = health.status === 'healthy' ? 'ok' : (health.status === 'degraded' ? 'warning' : 'error');
  const statusLabel = {
    healthy: 'Healthy',
    degraded: 'Degraded',
    error: 'Error',
  }[health.status] || 'Unknown';
  
  const healthPercentage = health.health.percentage || 0;
  const tone = healthPercentage === 100 ? 'healthy' : (healthPercentage >= 75 ? 'watch' : 'alert');
  
  return {
    statusCode,
    statusLabel,
    healthPercentage,
    tone,
    message: health.errorMessage || `${health.health.healthyCollections}/${health.health.totalCollections} collections active`,
    timestamp: health.timestamp,
    responseTime: health.responseTimeMs,
  };
}

module.exports = {
  checkDatabaseHealth,
  getHealthSummary,
  formatHealthDisplay,
};
