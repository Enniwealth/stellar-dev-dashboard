import { createRequire } from 'module'
const require = createRequire(import.meta.url)
const { FederatedLearningIntegration } = require('./integration.cjs')
export { FederatedLearningIntegration }
