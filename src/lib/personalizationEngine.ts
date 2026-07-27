import { getStoredValue, setStoredValue } from './storage'
import { addBreadcrumb } from './errorReporting'

export interface InteractionEvent {
  type: 'tab_visit' | 'widget_view' | 'widget_add' | 'widget_remove' | 'widget_resize' | 'feature_use' | 'correction' | 'explicit_feedback'
  target: string
  timestamp: number
  metadata?: Record<string, unknown>
}

export interface WidgetScore {
  widgetType: string
  score: number
  reason: string
}

export interface LayoutSuggestion {
  widgetType: string
  position: number
  span: number
  confidence: number
  reason: string
}

export interface PersonalizationProfile {
  version: number
  userId: string
  createdAt: string
  updatedAt: string
  interactionHistory: InteractionEvent[]
  tabFrequency: Record<string, number>
  widgetFrequency: Record<string, number>
  widgetUsageDuration: Record<string, number>
  featureFrequency: Record<string, number>
  dismissedSuggestions: string[]
  acceptedSuggestions: string[]
  corrections: Record<string, number>
  explicitPreferences: Record<string, number>
  lastRecommendations: LayoutSuggestion[]
  learningEnabled: boolean
  transparencyLevel: 'full' | 'summary' | 'minimal'
  privacyMode: boolean
}

const PERSONALIZATION_KEY = 'personalization-profile-v1'
const MAX_HISTORY = 1000
const CURRENT_VERSION = 1

export function generateUserId(): string {
  return `user-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
}

export function createDefaultProfile(userId?: string): PersonalizationProfile {
  return {
    version: CURRENT_VERSION,
    userId: userId || generateUserId(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    interactionHistory: [],
    tabFrequency: {},
    widgetFrequency: {},
    widgetUsageDuration: {},
    featureFrequency: {},
    dismissedSuggestions: [],
    acceptedSuggestions: [],
    corrections: {},
    explicitPreferences: {},
    lastRecommendations: [],
    learningEnabled: true,
    transparencyLevel: 'full',
    privacyMode: false,
  }
}

export async function loadPersonalizationProfile(): Promise<PersonalizationProfile> {
  try {
    const stored = await getStoredValue(PERSONALIZATION_KEY) as PersonalizationProfile | null
    if (stored) {
      return { ...createDefaultProfile(stored.userId), ...stored }
    }
    const profile = createDefaultProfile()
    await setStoredValue(PERSONALIZATION_KEY, profile)
    return profile
  } catch {
    return createDefaultProfile()
  }
}

export async function savePersonalizationProfile(profile: PersonalizationProfile): Promise<void> {
  profile.updatedAt = new Date().toISOString()
  if (profile.interactionHistory.length > MAX_HISTORY) {
    profile.interactionHistory = profile.interactionHistory.slice(-MAX_HISTORY)
  }
  await setStoredValue(PERSONALIZATION_KEY, profile)
}

export async function recordInteraction(
  profile: PersonalizationProfile,
  event: Omit<InteractionEvent, 'timestamp'>
): Promise<PersonalizationProfile> {
  if (!profile.learningEnabled) return profile

  const fullEvent: InteractionEvent = {
    ...event,
    timestamp: Date.now(),
  }

  profile.interactionHistory.push(fullEvent)

  if (event.type === 'tab_visit') {
    profile.tabFrequency[event.target] = (profile.tabFrequency[event.target] || 0) + 1
  } else if (event.type === 'widget_view' || event.type === 'widget_add') {
    profile.widgetFrequency[event.target] = (profile.widgetFrequency[event.target] || 0) + 1
  } else if (event.type === 'widget_remove') {
    profile.widgetFrequency[event.target] = Math.max(0, (profile.widgetFrequency[event.target] || 0) - 1)
  } else if (event.type === 'feature_use') {
    profile.featureFrequency[event.target] = (profile.featureFrequency[event.target] || 0) + 1
  } else if (event.type === 'correction') {
    profile.corrections[event.target] = (profile.corrections[event.target] || 0) + 1
  } else if (event.type === 'explicit_feedback') {
    const key = event.target
    profile.explicitPreferences[key] = event.metadata?.value as number || 0
  }

  await savePersonalizationProfile(profile)
  return profile
}

export function computeWidgetRecommendations(
  profile: PersonalizationProfile,
  availableWidgets: string[],
  existingWidgets: string[],
  topN: number = 3
): WidgetScore[] {
  const scores: WidgetScore[] = []

  for (const widgetType of availableWidgets) {
    if (existingWidgets.includes(widgetType)) continue

    let score = 0
    const reasons: string[] = []

    const usageCount = profile.widgetFrequency[widgetType] || 0
    if (usageCount > 0) {
      const usageScore = Math.min(usageCount / 10, 1) * 40
      score += usageScore
      if (usageCount > 2) reasons.push(`Used ${usageCount} times`)
    }

    const correctionPenalty = profile.corrections[`widget_${widgetType}`] || 0
    if (correctionPenalty > 0) {
      score -= Math.min(correctionPenalty * 5, 20)
    }

    const explicitPref = profile.explicitPreferences[`widget_${widgetType}`] || 0
    score += explicitPref * 10

    if (profile.dismissedSuggestions.includes(widgetType)) {
      score -= 15
    }
    if (profile.acceptedSuggestions.includes(widgetType)) {
      score += 10
    }

    const recommendedWidgets = ['balance', 'transactions', 'networkStats']
    if (recommendedWidgets.includes(widgetType)) {
      score += 5
    }

    const tabContext = getTabContextFromUsage(profile)
    if (tabContext[widgetType]) {
      score += tabContext[widgetType] * 10
    }

    scores.push({
      widgetType,
      score: Math.max(0, Math.min(100, score)),
      reason: reasons.length > 0 ? reasons[0] : score > 50 ? 'Highly recommended' : 'Consider adding',
    })
  }

  scores.sort((a, b) => b.score - a.score)
  return scores.slice(0, topN)
}

export function optimizeLayout(
  profile: PersonalizationProfile,
  currentWidgets: string[],
  allWidgetTypes: string[]
): LayoutSuggestion[] {
  const suggestions: LayoutSuggestion[] = []
  const usedTypes = new Set(currentWidgets)

  const topWidgetTypes = Object.entries(profile.widgetFrequency)
    .filter(([type]) => !usedTypes.has(type))
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3)
    .map(([type, count]) => ({ type, count }))

  let position = currentWidgets.length
  for (const { type, count } of topWidgetTypes) {
    const totalInteractions = Object.values(profile.widgetFrequency).reduce((a, b) => a + b, 0) || 1
    const confidence = Math.min((count / totalInteractions) * 100, 95)
    suggestions.push({
      widgetType: type,
      position,
      span: 1,
      confidence: Math.round(confidence),
      reason: count > 5
        ? `Frequently used widget`
        : `Based on your activity patterns`,
    })
    position++
  }

  if (suggestions.length === 0) {
    const starterWidgets = allWidgetTypes.filter(w => !usedTypes.has(w))
    for (let i = 0; i < Math.min(2, starterWidgets.length); i++) {
      suggestions.push({
        widgetType: starterWidgets[i],
        position: currentWidgets.length + i,
        span: 1,
        confidence: 30,
        reason: 'Getting started recommendation',
      })
    }
  }

  return suggestions
}

function getTabContextFromUsage(profile: PersonalizationProfile): Record<string, number> {
  const context: Record<string, number> = {}
  const tabWidgetMap: Record<string, string[]> = {
    overview: ['balance', 'networkStats', 'accountStats'],
    account: ['balance', 'accountStats', 'assets'],
    transactions: ['transactions'],
    network: ['networkStats', 'ledgerStats'],
    portfolio: ['priceTicker', 'portfolio'],
  }

  for (const [tab, widgets] of Object.entries(tabWidgetMap)) {
    const tabVisits = profile.tabFrequency[tab] || 0
    if (tabVisits > 0) {
      for (const widget of widgets) {
        context[widget] = (context[widget] || 0) + tabVisits * 0.1
      }
    }
  }

  return context
}

export interface PersonalizationStats {
  totalInteractions: number
  uniqueTabsVisited: number
  uniqueWidgetsUsed: number
  topTabs: { tab: string; count: number }[]
  topWidgets: { widget: string; count: number }[]
  learningActive: boolean
  suggestionsAccepted: number
  suggestionsDismissed: number
  correctionsMade: number
  estimatedEfficiencyGain: number
}

export function computePersonalizationStats(profile: PersonalizationProfile): PersonalizationStats {
  const totalInteractions = profile.interactionHistory.length
  const uniqueTabsVisited = Object.keys(profile.tabFrequency).length
  const uniqueWidgetsUsed = Object.keys(profile.widgetFrequency).length

  const topTabs = Object.entries(profile.tabFrequency)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([tab, count]) => ({ tab, count }))

  const topWidgets = Object.entries(profile.widgetFrequency)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([widget, count]) => ({ widget, count }))

  const suggestionsAccepted = profile.acceptedSuggestions.length
  const suggestionsDismissed = profile.dismissedSuggestions.length
  const correctionsMade = Object.values(profile.corrections).reduce((a, b) => a + b, 0)

  const recommendedUsed = profile.acceptedSuggestions.length
  const totalRecs = profile.acceptedSuggestions.length + profile.dismissedSuggestions.length || 1
  const acceptanceRate = recommendedUsed / totalRecs
  const estimatedEfficiencyGain = Math.min(Math.round(acceptanceRate * 30 + uniqueWidgetsUsed * 2), 100)

  return {
    totalInteractions,
    uniqueTabsVisited,
    uniqueWidgetsUsed,
    topTabs,
    topWidgets,
    learningActive: profile.learningEnabled,
    suggestionsAccepted,
    suggestionsDismissed,
    correctionsMade,
    estimatedEfficiencyGain: Math.max(0, estimatedEfficiencyGain),
  }
}

export async function recordSuggestionAccepted(profile: PersonalizationProfile, widgetType: string): Promise<PersonalizationProfile> {
  if (!profile.acceptedSuggestions.includes(widgetType)) {
    profile.acceptedSuggestions.push(widgetType)
  }
  profile.dismissedSuggestions = profile.dismissedSuggestions.filter(s => s !== widgetType)
  await savePersonalizationProfile(profile)
  addBreadcrumb('Personalization suggestion accepted', 'system', { widgetType })
  return profile
}

export async function recordSuggestionDismissed(profile: PersonalizationProfile, widgetType: string): Promise<PersonalizationProfile> {
  if (!profile.dismissedSuggestions.includes(widgetType)) {
    profile.dismissedSuggestions.push(widgetType)
  }
  await savePersonalizationProfile(profile)
  addBreadcrumb('Personalization suggestion dismissed', 'system', { widgetType })
  return profile
}

export function getWidgetEfficiencyScore(profile: PersonalizationProfile, widgetType: string): number {
  const usage = profile.widgetFrequency[widgetType] || 0
  const duration = profile.widgetUsageDuration[widgetType] || 0
  const corrections = profile.corrections[`widget_${widgetType}`] || 0
  const explicitPref = profile.explicitPreferences[`widget_${widgetType}`] || 0

  let score = 50
  score += Math.min(usage * 5, 25)
  score += Math.min(duration / 1000, 10)
  score -= Math.min(corrections * 10, 20)
  score += explicitPref * 10

  return Math.max(0, Math.min(100, score))
}

export function resetPersonalization(): Promise<PersonalizationProfile> {
  const profile = createDefaultProfile()
  return setStoredValue(PERSONALIZATION_KEY, profile).then(() => profile)
}

export async function migratePersonalizationProfile(stored: Record<string, unknown>): Promise<PersonalizationProfile> {
  const defaults = createDefaultProfile()
  const migrated: PersonalizationProfile = {
    ...defaults,
    ...stored as unknown as PersonalizationProfile,
  }
  if (!migrated.userId) migrated.userId = defaults.userId
  if (!migrated.createdAt) migrated.createdAt = defaults.createdAt
  migrated.version = CURRENT_VERSION
  return migrated
}

export function identifyPeakUsageHours(profile: PersonalizationProfile): number[] {
  const hourCounts: Record<number, number> = {}
  for (const event of profile.interactionHistory) {
    const hour = new Date(event.timestamp).getHours()
    hourCounts[hour] = (hourCounts[hour] || 0) + 1
  }
  return Object.entries(hourCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([hour]) => parseInt(hour))
    .sort()
}

export function detectPowerUser(profile: PersonalizationProfile): boolean {
  const stats = computePersonalizationStats(profile)
  return stats.totalInteractions > 200 && stats.uniqueTabsVisited > 10 && stats.uniqueWidgetsUsed > 5
}

export function detectCasualUser(profile: PersonalizationProfile): boolean {
  const stats = computePersonalizationStats(profile)
  return stats.totalInteractions < 50 && stats.uniqueTabsVisited < 5
}

export function computeLayoutCompactnessScore(profile: PersonalizationProfile): number {
  if (detectPowerUser(profile)) return 0.7
  if (detectCasualUser(profile)) return 0.3
  return 0.5
}
