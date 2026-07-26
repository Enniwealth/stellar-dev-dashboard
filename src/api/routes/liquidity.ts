import { Router, Request, Response } from 'express';
import { predictLiquidityAndPrice, getModelMetrics } from '../../ml/liquidityPredictionModel';
import { checkLiquidityAlertRules } from '../../lib/liquidityAlerts';
import { cacheMiddleware } from '../middleware/predictCache';

const router = Router();

// GET prediction for a specific trading pair
router.get('/v1/liquidity/predict', cacheMiddleware, async (req: Request, res: Response) => {
  const pair = req.query.pair as string;
  if (!pair) {
    return res.status(400).json({ error: 'Missing required query parameter: pair' });
  }
  try {
    // In a real implementation we would fetch the latest snapshot from a data feeder
    const snapshot = await import(`../data/snapshots/${pair}.json`).then(m => m.default);
    const prediction = predictLiquidityAndPrice(snapshot);
    // Run alert rules and fire notifications if conditions are met
    checkLiquidityAlertRules(prediction);
    res.json(prediction);
  } catch (err) {
    console.error('Liquidity prediction error', err);
    res.status(500).json({ error: 'Failed to generate prediction' });
  }
});

// GET model health & metrics
router.get('/v1/liquidity/metrics', async (_req: Request, res: Response) => {
  try {
    const metrics = getModelMetrics();
    res.json(metrics);
  } catch (err) {
    console.error('Metrics error', err);
    res.status(500).json({ error: 'Failed to retrieve metrics' });
  }
});

export default router;
