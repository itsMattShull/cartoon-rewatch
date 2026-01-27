import { RegExpMatcher, TextCensor, DataSet, englishDataset, englishRecommendedTransformers, parseRawPattern, asteriskCensorStrategy } from 'obscenity'

const EXTRA_PHRASES = parsePhraseList(process.env.CHAT_CENSOR_EXTRA)

const dataset = buildDataset(EXTRA_PHRASES)
const matcher = new RegExpMatcher({
  ...dataset.build(),
  ...englishRecommendedTransformers
})
const censor = new TextCensor().setStrategy(asteriskCensorStrategy())

function parsePhraseList(raw) {
  if (!raw || typeof raw !== 'string') return []
  return raw
    .split(/[\n,]/g)
    .map((value) => value.trim())
    .filter(Boolean)
}

function buildDataset(extraPhrases) {
  const next = new DataSet().addAll(englishDataset)
  if (!Array.isArray(extraPhrases)) return next

  for (const phrase of extraPhrases) {
    const isRaw = phrase.startsWith('raw:')
    const patternSource = isRaw ? phrase.slice(4).trim() : `|${escapePatternLiteral(phrase)}|`
    if (!patternSource) continue
    try {
      const parsedPattern = parseRawPattern(patternSource)
      next.addPhrase((builder) => builder.addPattern(parsedPattern))
    } catch (error) {
      console.warn(`Invalid chat censor pattern ignored: "${phrase}"`, error)
    }
  }

  return next
}

function escapePatternLiteral(value) {
  return value.replace(/[\\?\[\]\|]/g, '\\$&')
}

export function censorChatText(text) {
  if (typeof text !== 'string' || !text) return text
  const matches = matcher.getAllMatches(text)
  if (!matches.length) return text
  return censor.applyTo(text, matches)
}

export function getChatCensorConfig() {
  return {
    extra: [...EXTRA_PHRASES]
  }
}
