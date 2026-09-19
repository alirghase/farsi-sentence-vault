// Closed vocabulary of Persian learner errors.
//
// MIRRORS core/taxonomy.py — tools/check_mirror.py enforces that they match.
// The set is closed on purpose: free-form tags from an LLM fragment across runs
// ("ezafe" / "ezāfe" / "missing ezafe"), which splits the per-tag counts and
// makes the "target my weak spots" loop aim at noise.

export const ERROR_TAGS = {
  'ezafe': {
    title: 'Ezâfe',
    detail: 'Missing, added, or misplaced ezâfe (the -e/-ye linking vowel).',
  },
  'ra-marker': {
    title: 'Object marker',
    detail: 'Object marker را missing, added wrongly, or misplaced.',
  },
  'verb-tense': {
    title: 'Verb tense',
    detail: 'Wrong tense (past vs present vs perfect vs progressive).',
  },
  'subjunctive': {
    title: 'Subjunctive',
    detail: 'Subjunctive missing or malformed after a modal/wish/necessity.',
  },
  'verb-agreement': {
    title: 'Verb agreement',
    detail: 'Verb ending disagrees with the subject in person or number.',
  },
  'word-order': {
    title: 'Word order',
    detail: 'Constituents out of order; Persian is subject-object-verb.',
  },
  'preposition': {
    title: 'Prepositions',
    detail: 'Wrong or missing preposition (به/از/با/در/روی/تو).',
  },
  'pronoun-clitic': {
    title: 'Attached pronouns',
    detail: 'Attached possessive/object pronouns (-am/-et/-esh) wrong.',
  },
  'plural': {
    title: 'Plurals',
    detail: 'Plural formation wrong (ها/ان), or plural where Persian uses singular.',
  },
  'compound-verb': {
    title: 'Compound verbs',
    detail: 'Wrong light verb (کردن/شدن/زدن/دادن/گرفتن) or wrong nominal part.',
  },
  'vocab-gap': {
    title: 'Missing vocabulary',
    detail: 'Did not produce the needed word at all.',
  },
  'vocab-wrong': {
    title: 'Wrong word choice',
    detail: 'Produced a word that exists but is the wrong choice here.',
  },
  'formality': {
    title: 'Formality',
    detail: 'Register mismatch: formal where informal is natural, or vice versa.',
  },
  'colloquial': {
    title: 'Spoken vs written',
    detail: 'Bookish form where spoken Persian differs (می‌روم vs می‌رم).',
  },
  'spelling': {
    title: 'Spelling',
    detail: 'Persian script spelling error, including ZWNJ (نیم‌فاصله).',
  },
  'naturalness': {
    title: 'Naturalness',
    detail: 'Grammatical and understandable, but not how a native would say it.',
  },
};

export const ERROR_TAG_KEYS = Object.keys(ERROR_TAGS).sort();

export function tagTitle(key) {
  return ERROR_TAGS[key]?.title ?? key;
}

export const SITUATIONS = [
  'phone call with family',
  'ordering food or coffee',
  'shopping and asking prices',
  'giving or following directions',
  'making plans with a friend',
  'apologising or explaining lateness',
  'disagreeing politely',
  'talking about the past (what you did)',
  'talking about future plans',
  'expressing an opinion',
  'small talk about weather or traffic',
  'at the doctor or pharmacy',
  'taxi, metro, and travel',
  'complaining about something not working',
  'asking someone to repeat or clarify',
  'compliments and thanking (taarof)',
  'talking about work or study',
  'describing how you feel',
  "hosting or visiting someone's home",
  'negotiating or asking for a favour',
];
