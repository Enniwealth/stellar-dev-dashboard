/**
 * Throughput Forecasting Model for Stellar Network
 * 
 * Predicts future transaction throughput (TPS/OPS) using:
 * - Double Exponential Smoothing (Holt's method) for trend capture
 * - Linear regression for capacity utilization forecasting
 * - Confidence intervals via residual analysis
 * 
 * Designed for client-side execution with minimal compute overhead.
 */

class ThroughputForecaster {
  constructor(config = {}) {
    this.smoothingAlpha = config.smoothingAlpha || 0.3;
    this.smoothingBeta = config.smoothingBeta || 0.1;
    this.minDataPoints = config.minDataPoints || 10;
    this.ledgerCapacity = config.ledgerCapacity || 1000;
    this.confidenceLevel = config.confidenceLevel || 0.95;
    
    this.history = [];
    this.fitted = false;
    this.level = 0;
    this.trend = 0;
    this.residuals = [];
    this.variance = 0;
  }

  /**
   * Add a historical ledger data point
   * @param {object} ledger - Ledger data with operation_count, successful_transaction_count, closed_at
   */
  addLedgerData(ledger) {
    if (!ledger) return;

    const entry = {
      timestamp: new Date(ledger.closed_at || ledger.closedAt || Date.now()).getTime(),
      ops: ledger.operation_count || ledger.ops || 0,
      txCount: ledger.successful_transaction_count || ledger.txCount || 0,
      failedCount: ledger.failed_transaction_count || ledger.failedCount || 0,
      sequence: ledger.sequence || 0,
    };

    const closeTime = ledger.close_time || ledger.closeTime || 5.0;
    entry.opsPerSecond = entry.ops / Math.max(1, closeTime);
    entry.tps = entry.txCount / Math.max(1, closeTime);
    entry.congestionRatio = Math.min(entry.ops / this.ledgerCapacity, 1.0);

    this.history.push(entry);

    if (this.history.length > 500) {
      this.history.shift();
    }

    this.fitted = false;
  }

  /**
   * Fit the model to current history using Holt's Double Exponential Smoothing
   */
  fit() {
    if (this.history.length < this.minDataPoints) {
      return false;
    }

    const values = this.history.map(h => h.tps);

    this.level = values[0];
    this.trend = 0;

    if (values.length >= 2) {
      this.trend = (values[1] - values[0]);
    }

    this.residuals = [];
    let prevLevel = this.level;
    let prevTrend = this.trend;

    for (let i = 0; i < values.length; i++) {
      const level = this.smoothingAlpha * values[i] + (1 - this.smoothingAlpha) * (prevLevel + prevTrend);
      const trend = this.smoothingBeta * (level - prevLevel) + (1 - this.smoothingBeta) * prevTrend;
      
      this.residuals.push(values[i] - (prevLevel + prevTrend));
      
      prevLevel = level;
      prevTrend = trend;
    }

    this.level = prevLevel;
    this.trend = prevTrend;

    const n = this.residuals.length;
    if (n > 1) {
      const mean = this.residuals.reduce((a, b) => a + b, 0) / n;
      this.variance = this.residuals.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / (n - 1);
    } else {
      this.variance = 0;
    }

    this.fitted = true;
    return true;
  }

  /**
   * Generate forecast for next N periods
   * @param {number} periodsAhead - Number of future periods to forecast
   * @returns {object} Forecast with predictions and confidence intervals
   */
  forecast(periodsAhead = 10) {
    if (!this.fitted) {
      if (!this.fit()) {
        return this.generateDefaultForecast(periodsAhead);
      }
    }

    const predictions = [];
    const lastTimestamp = this.history[this.history.length - 1]?.timestamp || Date.now();
    const avgInterval = this.calculateAverageInterval();

    for (let h = 1; h <= periodsAhead; h++) {
      const predictedTps = this.level + h * this.trend;
      const predictedOps = predictedTps * 5.0;

      const zScore = this.getZScore(this.confidenceLevel);
      const stdError = Math.sqrt(this.variance);
      const margin = zScore * stdError * Math.sqrt(h);

      predictions.push({
        horizon: h,
        timestamp: lastTimestamp + h * avgInterval,
        predictedTps: Math.max(0, predictedTps),
        predictedOps: Math.max(0, predictedOps),
        lowerBound: Math.max(0, predictedTps - margin),
        upperBound: predictedTps + margin,
        congestionUtilization: Math.min(Math.max(0, predictedOps) / this.ledgerCapacity, 1.0),
      });
    }

    return {
      predictions,
      currentLevel: this.level,
      currentTrend: this.trend,
      trendDirection: this.trend > 0.1 ? 'increasing' : this.trend < -0.1 ? 'decreasing' : 'stable',
      volatility: Math.sqrt(this.variance),
      fitQuality: this.calculateRSquared(),
      dataPoints: this.history.length,
      forecastPeriods: periodsAhead,
    };
  }

  /**
   * Predict capacity utilization for a given time horizon
   * @param {number} hoursAhead - Hours into the future
   * @returns {object} Capacity utilization forecast
   */
  forecastCapacityUtilization(hoursAhead = 1) {
    const periodsAhead = Math.ceil((hoursAhead * 3600) / 5.0);
    const result = this.forecast(periodsAhead);

    const currentUtilization = this.history.length > 0 
      ? this.history[this.history.length - 1].congestionRatio 
      : 0;

    const futureUtilizations = result.predictions.map(p => p.congestionUtilization);
    const maxUtilization = Math.max(...futureUtilizations);
    const avgUtilization = futureUtilizations.reduce((a, b) => a + b, 0) / futureUtilizations.length;

    return {
      currentUtilization,
      avgUtilization,
      maxUtilization,
      timeHorizonHours: hoursAhead,
      predictions: result.predictions,
      scalingScenario: maxUtilization > 0.8 ? 'capacity-constrained' : maxUtilization > 0.5 ? 'moderate-load' : 'normal',
    };
  }

  /**
   * Analyze scaling scenarios based on current trends
   * @returns {object} Scaling analysis
   */
  analyzeScalingScenario() {
    if (this.history.length < 20) {
      return {
        scenario: 'insufficient-data',
        recommendation: 'Need at least 20 data points for scaling analysis',
      };
    }

    const recentHistory = this.history.slice(-50);
    const recentUtilizations = recentHistory.map(h => h.congestionRatio);
    const avgUtilization = recentUtilizations.reduce((a, b) => a + b, 0) / recentUtilizations.length;
    const peakUtilization = Math.max(...recentUtilizations);

    const growthRate = this.trend / Math.max(0.001, this.level) * 100;

    let scenario = 'normal';
    let riskLevel = 'low';
    let recommendation = '';

    if (peakUtilization > 0.9) {
      scenario = 'critical';
      riskLevel = 'high';
      recommendation = 'Network operating near capacity. Consider protocol upgrades or capacity expansion.';
    } else if (avgUtilization > 0.7 || growthRate > 5) {
      scenario = 'approaching-capacity';
      riskLevel = 'medium';
      recommendation = 'Throughput trending upward. Monitor closely and prepare scaling solutions.';
    } else if (growthRate < -5) {
      scenario = 'declining';
      riskLevel = 'low';
      recommendation = 'Network activity declining. No immediate scaling action needed.';
    } else {
      scenario = 'normal';
      riskLevel = 'low';
      recommendation = 'Network operating within normal capacity bounds.';
    }

    return {
      scenario,
      riskLevel,
      recommendation,
      metrics: {
        avgUtilization,
        peakUtilization,
        growthRate,
        currentTps: this.level,
        trend: this.trend,
      },
    };
  }

  calculateAverageInterval() {
    if (this.history.length < 2) return 5000;
    let totalInterval = 0;
    for (let i = 1; i < this.history.length; i++) {
      totalInterval += this.history[i].timestamp - this.history[i - 1].timestamp;
    }
    return totalInterval / (this.history.length - 1);
  }

  getZScore(confidenceLevel) {
    const alpha = 1 - confidenceLevel;
    const p = 1 - alpha / 2;
    const a1 = -3.969683028665376e+01;
    const a2 = 2.209460984245205e+02;
    const a3 = -2.759285104469687e+02;
    const a4 = 1.383577518672690e+02;
    const a5 = -3.066479806614716e+01;
    const a6 = 2.506628277459239e+00;
    const b1 = -5.447609879822406e+01;
    const b2 = 1.615858368580409e+02;
    const b3 = -1.556989798598866e+02;
    const b4 = 6.680131188771972e+01;
    const b5 = -1.328068155288572e+01;
    const c1 = -7.784894002430293e-03;
    const c2 = -3.223964580411365e-01;
    const c3 = -2.400758277161838e+00;
    const c4 = -2.549732539343734e+00;
    const c5 = 4.374664141464968e+00;
    const c6 = 2.938163982698783e+00;
    const d1 = 7.784695709041462e-03;
    const d2 = 3.224671290700398e-01;
    const d3 = 2.445134137142996e+00;
    const d4 = 3.754408661907416e+00;
    const pLow = 0.02425;
    const pHigh = 1 - pLow;
    let q, r;

    if (p < pLow) {
      q = Math.sqrt(-2 * Math.log(p));
      return (((((c1 * q + c2) * q + c3) * q + c4) * q + c5) * q + c6) /
        ((((d1 * q + d2) * q + d3) * q + d4) * q + 1);
    } else if (p <= pHigh) {
      q = p - 0.5;
      r = q * q;
      return (((((a1 * r + a2) * r + a3) * r + a4) * r + a5) * r + a6) * q /
        (((((b1 * r + b2) * r + b3) * r + b4) * r + b5) * r + 1);
    } else {
      q = Math.sqrt(-2 * Math.log(1 - p));
      return -(((((c1 * q + c2) * q + c3) * q + c4) * q + c5) * q + c6) /
        ((((d1 * q + d2) * q + d3) * q + d4) * q + 1);
    }
  }

  calculateRSquared() {
    if (this.history.length < 2) return 0;
    const values = this.history.map(h => h.tps);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const ssTotal = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0);
    const ssResidual = this.residuals.reduce((sum, r) => sum + Math.pow(r, 2), 0);
    if (ssTotal === 0) return 1;
    return Math.max(0, 1 - ssResidual / ssTotal);
  }

  generateDefaultForecast(periodsAhead) {
    const lastEntry = this.history[this.history.length - 1];
    const avgTps = lastEntry ? lastEntry.tps : 0;
    const avgInterval = this.calculateAverageInterval();
    const lastTimestamp = lastEntry?.timestamp || Date.now();

    const predictions = [];
    for (let h = 1; h <= periodsAhead; h++) {
      predictions.push({
        horizon: h,
        timestamp: lastTimestamp + h * avgInterval,
        predictedTps: avgTps,
        predictedOps: avgTps * 5.0,
        lowerBound: avgTps * 0.7,
        upperBound: avgTps * 1.3,
        congestionUtilization: (avgTps * 5.0) / this.ledgerCapacity,
      });
    }

    return {
      predictions,
      currentLevel: avgTps,
      currentTrend: 0,
      trendDirection: 'unknown',
      volatility: 0,
      fitQuality: 0,
      dataPoints: this.history.length,
      forecastPeriods: periodsAhead,
    };
  }

  /**
   * Save model state for persistence
   */
  save() {
    return {
      level: this.level,
      trend: this.trend,
      variance: this.variance,
      history: this.history.slice(-200),
      config: {
        smoothingAlpha: this.smoothingAlpha,
        smoothingBeta: this.smoothingBeta,
        minDataPoints: this.minDataPoints,
        ledgerCapacity: this.ledgerCapacity,
        confidenceLevel: this.confidenceLevel,
      },
    };
  }

  /**
   * Load model from saved state
   */
  static load(state) {
    const forecaster = new ThroughputForecaster(state.config);
    forecaster.level = state.level;
    forecaster.trend = state.trend;
    forecaster.variance = state.variance;
    forecaster.history = state.history || [];
    forecaster.fitted = forecaster.history.length >= forecaster.minDataPoints;
    return forecaster;
  }
}

export default ThroughputForecaster;
