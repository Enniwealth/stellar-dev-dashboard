import { createRequire } from 'module'
const require = createRequire(import.meta.url)
const { PrivacyPreservingCollector } = require('./privacy.cjs')
export { PrivacyPreservingCollector }
