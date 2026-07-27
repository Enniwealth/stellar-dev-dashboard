import express from 'express'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { analyzeContractUpgrade } from './contract_upgrade_analysis/contractUpgradeAnalysis.js'
import { scoreTransaction } from './scoringEngine.js'
import { FederatedLearningIntegration } from './federated/integration.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const app = express()
app.use(express.json())

// Initialize federated learning integration
const federatedIntegration = new FederatedLearningIntegration({
  enableFederatedLearning: process.env.ENABLE_FEDERATED === 'true',
  federatedServerUrl: process.env.FEDERATED_SERVER_URL || 'http://localhost:4002',
  privacy: {
    epsilon: parseFloat(process.env.PRIVACY_EPSILON) || 1.0,
    delta: parseFloat(process.env.PRIVACY_DELTA) || 1e-5
  }
});

// Initialize on startup
federatedIntegration.initialize().catch(console.error);

app.post('/score', async (req, res) => {
  try {
    const tx = req.body;
    const result = await scoreTransaction(tx);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Federated learning scoring endpoint
app.post('/score-federated', async (req, res) => {
  try {
    const tx = req.body;
    const result = await federatedIntegration.scoreTransactionWithFederated(tx);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// simple feedback endpoint: accept {tx, label}
app.post('/feedback', (req, res) => {
  try {
    const { tx, label } = req.body
    const fbDir = path.resolve(__dirname, 'data')
    fs.mkdirSync(fbDir, { recursive: true })
    const fbPath = path.join(fbDir, 'feedback.json')
    const arr = fs.existsSync(fbPath) ? JSON.parse(fs.readFileSync(fbPath)) : []
    arr.push({ tx, label, timestamp: Date.now() })
    fs.writeFileSync(fbPath, JSON.stringify(arr, null, 2))
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.post('/analyze-upgrade', async (req, res) => {
  try {
    const analysis = analyzeContractUpgrade(req.body)
    res.json(analysis)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Federated learning feedback endpoint
app.post('/feedback-federated', async (req, res) => {
  try {
    const { tx, label, privacyBudget } = req.body;
    const result = await federatedIntegration.collectFeedback(tx, label, privacyBudget);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Participate in federated learning round
app.post('/federated-train', async (req, res) => {
  try {
    const { transactions } = req.body;
    const result = await federatedIntegration.participateInFederatedRound(transactions);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get federated learning status
app.get('/federated-status', (req, res) => {
  try {
    const status = federatedIntegration.getFederatedStatus();
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Sync with federated server
app.post('/federated-sync', async (req, res) => {
  try {
    const result = await federatedIntegration.syncWithServer();
    res.json({ success: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const port = process.env.PORT || 4001
app.listen(port, () => {
  console.info('ML scoring server running on port', port)
})
