/**
 * Pure text sanitizer for narration headed to TTS.
 *
 * Wikipedia lead paragraphs routinely carry an IPA pronunciation gloss right after
 * the headword — "Hannover [haˈnoːfɐ] …", "Kiel (IPA: [kiːl]) …". Piper would read
 * those bracketed phonetic strings aloud as gibberish, so we strip them BEFORE
 * synthesis (and before buildVerbatimStoryboard adopts the source sentences).
 *
 * This is a pure regex pass — NO LLM, NO rewriting. It only removes bracketed IPA;
 * ordinary parentheticals and numbers are left untouched, e.g. "(Hansestadt)" and
 * "(2023)" survive verbatim. Ported to JS from the operator's Atlas-fix Python
 * pattern to stay consistent across the demo portfolio.
 */

// A bracketed group that contains at least one IPA-only marker
// (stress ˈ ˌ, length ː ˑ, tie ‿, tone letters ˥˦˧˨˩) — i.e. a phonetic gloss.
const IPA = /[[(（][^[\]()（）]*[ˈˌːˑ‿˥˦˧˨˩][^[\]()（）]*[\])）]/g;
// A bracketed group explicitly labelled "IPA" (catches the "(IPA: …)" wrapper and
// any leftover label after the inner phonetic string was removed).
const IPA_LABEL = /[[(（][^[\]()（）]*\bIPA\b[^[\]()（）]*[\])）]/gi;

/**
 * Remove IPA pronunciation glosses from narration text; leave facts, numbers, and
 * ordinary parentheticals intact. Idempotent — safe to apply more than once.
 * @param {string} text
 * @returns {string}
 */
export function stripPronunciation(text) {
  let t = String(text ?? "");
  t = t.replace(IPA, "");
  t = t.replace(IPA_LABEL, "");
  t = t.replace(/\s{2,}/g, " "); // collapse the gaps the removals left
  t = t.replace(/\s+([,.;:!?])/g, "$1"); // drop space stranded before punctuation
  return t.trim();
}
