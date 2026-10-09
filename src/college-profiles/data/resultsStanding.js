/**
 * resultsStanding — where a program's record stands among its peers
 * (backlog G2, Damon 2026-10-09: "Rank among peers").
 *
 * Pure: no React, no Supabase. usePeerResults loads every program_results row
 * for the same division, gender and seasons; these helpers index those rows and
 * turn one season into plain-words standing for the Program performance card.
 * Tested by test/resultsStanding.test.mjs.
 *
 * WHY RANK AND NOT A MEDIAN
 *   A division's median win % is always close to .500, because every win is
 *   another team's loss, so a median line says almost nothing. Where a program
 *   sits among its peers does.
 *
 * THE RULES
 *  - Peers are the same season, the same NCAA division as stored on that
 *    season's row (a reclassifying program is compared with the division it
 *    played in that year) and the same men's / women's program.
 *  - Conference peers are the programs whose row carries the same conference
 *    that season, so a program that changed conference is compared with the
 *    conference it played in.
 *  - A program needs MIN_GAMES games before its record is ranked, and only
 *    peers with MIN_GAMES games count, so an early 2-0 start is not "the best
 *    record". The same 5-game rule as Explore's record sort.
 *  - "Better record than X%" counts peers with a strictly lower win %, rounded
 *    down, so it never overstates. Ties share a place ("tied 3rd").
 *  - Division standing needs MIN_DIV_PEERS peers and conference standing
 *    MIN_CONF_PEERS programs, or nothing is said.
 */

export const MIN_GAMES = 5
export const MIN_DIV_PEERS = 10
export const MIN_CONF_PEERS = 4

const num = v => (v == null || v === '' ? null : Number(v))

/** 'D-I' -> 'D1', 'D-II' -> 'D2', 'D-III' -> 'D3'; anything else unchanged. */
export function divShort(division) {
  const d = String(division || '').trim()
  const m = /^D-(I{1,3})$/.exec(d)
  if (m) return 'D' + m[1].length
  const n = /D\s*([123])$/i.exec(d)
  return n ? 'D' + n[1] : d
}

/** 1 -> '1st', 2 -> '2nd', 3 -> '3rd', 11 -> '11th', 22 -> '22nd'. */
export function ordinal(n) {
  const v = n % 100
  if (v >= 11 && v <= 13) return n + 'th'
  return n + ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th')
}

/** True while the season is still being played (until mid-December). */
export function inProgress(season, today = new Date()) {
  if (today.getFullYear() !== season) return false
  return !(today.getMonth() === 11 && today.getDate() >= 15)
}

function shape(r) {
  const w = num(r.wins) || 0, l = num(r.losses) || 0, t = num(r.ties) || 0
  const cw = num(r.conf_wins), cl = num(r.conf_losses), ct = num(r.conf_ties)
  const confGames = cw == null ? 0 : (cw || 0) + (cl || 0) + (ct || 0)
  return {
    id: r.school_id,
    season: Number(r.season),
    division: r.division || null,
    conference: r.conference || null,
    games: w + l + t,
    winPct: num(r.win_pct),
    confGames,
    confWinPct: confGames > 0 ? num(r.conf_win_pct) : null,
    rank: num(r.rpi_rank),
  }
}

/** program_results rows (one division and gender) -> Map('season|division' -> [record]). */
export function buildPeerIndex(rows) {
  const out = new Map()
  for (const r of rows || []) {
    const rec = shape(r)
    const key = rec.season + '|' + rec.division
    if (!out.has(key)) out.set(key, [])
    out.get(key).push(rec)
  }
  return out
}

function place(value, others) {
  const higher = others.filter(p => p.v > value).length
  const tied = others.some(p => p.v === value)
  return { rank: higher + 1, tied, of: others.length + 1 }
}

/**
 * Standing for one season of one program.
 *   schoolId  the program
 *   season    the season
 *   index     from buildPeerIndex
 *   scope     'div' or 'conf' (the page's "Compared against" switch)
 * Returns {
 *   tooFewGames   true when the program has fewer than MIN_GAMES games
 *   division      e.g. 'D1'
 *   record        div:  { kind:'div', pct, best, tied, n }
 *                 conf: { kind:'conf', rank, tied, of, conference }
 *   confRecord    conf scope only: { rank, tied, of, conference } by conference win %
 *   rankOf        how many programs hold an RPI / NPI rank that season
 * } or null when the program has no row in the index.
 */
export function standing(schoolId, season, index, scope = 'div') {
  if (!index) return null
  let own = null, list = null
  for (const [key, recs] of index) {
    if (!key.startsWith(season + '|')) continue
    const hit = recs.find(r => r.id === schoolId)
    if (hit) { own = hit; list = recs; break }
  }
  if (!own) return null

  const out = { tooFewGames: false, division: divShort(own.division), record: null, confRecord: null, rankOf: null }

  const ranked = list.filter(r => r.rank != null).length
  if (own.rank != null && ranked >= own.rank) out.rankOf = ranked

  if (own.games < MIN_GAMES || own.winPct == null) {
    out.tooFewGames = true
    return out
  }
  const others = list.filter(r => r.id !== schoolId && r.games >= MIN_GAMES && r.winPct != null)

  if (scope === 'conf') {
    if (own.conference) {
      const conf = others.filter(r => r.conference === own.conference)
      if (conf.length + 1 >= MIN_CONF_PEERS) {
        const p = place(own.winPct, conf.map(r => ({ v: r.winPct })))
        out.record = { kind: 'conf', ...p, conference: own.conference }
      }
      if (own.confWinPct != null) {
        const cp = list.filter(r => r.id !== schoolId && r.conference === own.conference && r.confWinPct != null)
        if (cp.length + 1 >= MIN_CONF_PEERS) {
          out.confRecord = { ...place(own.confWinPct, cp.map(r => ({ v: r.confWinPct }))), conference: own.conference }
        }
      }
    }
    return out
  }

  if (others.length >= MIN_DIV_PEERS) {
    const lower = others.filter(r => r.winPct < own.winPct).length
    const higher = others.filter(r => r.winPct > own.winPct).length
    out.record = {
      kind: 'div',
      pct: Math.floor((100 * lower) / others.length),
      best: higher === 0,
      tied: higher === 0 && others.some(r => r.winPct === own.winPct),
      n: others.length + 1,
    }
  }
  return out
}

function placeWords(p) {
  if (p.rank === 1) return p.tied ? 'Tied for the best' : 'Best'
  return (p.tied ? 'Tied ' : '') + ordinal(p.rank) + '-best'
}

/** "the Big Ten"; a name that already starts with "the" is left alone. */
function confName(c) {
  return /^the\s/i.test(c) ? c : 'the ' + c
}

/** Sentences under the headline record. peerLabel: e.g. 'D1 Women'. */
export function headlineLines(st, peerLabel) {
  if (!st) return []
  if (st.tooFewGames) return [{ text: `Standing among peers shows after ${MIN_GAMES} games.`, muted: true }]
  const out = []
  const r = st.record
  if (r && r.kind === 'div') {
    out.push({ text: r.best
      ? (r.tied ? `Tied for the best record in ${peerLabel}` : `Best record in ${peerLabel}`)
      : `Better record than ${r.pct}% of ${peerLabel}`,
      note: `of ${r.n} programs with ${MIN_GAMES}+ games` })
  } else if (r && r.kind === 'conf') {
    out.push({ text: `${placeWords(r)} record of ${r.of} in ${confName(r.conference)}` })
  }
  const c = st.confRecord
  if (c) out.push({ text: `${placeWords(c)} conference record of ${c.of}` })
  return out
}

/**
 * Short standing for one season row in the trend. The headline already names
 * the peer group, so a row names it only when it differs from the headline's:
 *   peerLabel   e.g. 'D2 Women' for a season played in another division, else null
 *   showConf    true for a season played in another conference
 */
export function rowText(st, peerLabel = null, showConf = false) {
  if (!st || st.tooFewGames || !st.record) return null
  const r = st.record
  if (r.kind === 'div') {
    const base = r.best ? (r.tied ? 'Tied best' : 'Best') : `Better than ${r.pct}%`
    return peerLabel ? `${base} ${r.best ? 'in' : 'of'} ${peerLabel}` : base
  }
  // "record" is spelled out so it is not read as the conference standing.
  const base = `${placeWords(r)} record of ${r.of}`
  return showConf ? `${base} in ${confName(r.conference)}` : base
}
