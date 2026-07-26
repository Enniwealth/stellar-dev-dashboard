import { createRequire } from 'module'
const require = createRequire(import.meta.url)
const { FederatedClient } = require('./client.cjs')
export { FederatedClient }
