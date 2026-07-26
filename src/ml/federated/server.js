import { createRequire } from 'module'
const require = createRequire(import.meta.url)
const { FederatedServer } = require('./server.cjs')
export { FederatedServer }
