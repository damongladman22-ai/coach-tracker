/**
 * Per-card copy for the InfoTip affordance. Keyed by lens, then by card/family.
 * Each entry: { title, what, read, source }.
 */

export const PROFILE_INFO = {
  size: {
    title: 'Height by position',
    what: 'The full height distribution of every player at each position in this segment — not just an average.',
    read: 'The dot is the median; the bar spans the middle-half of players (25th–75th percentile).',
    source: 'Player-level, pooled across all programs in the segment. Sample size (n) is shown in the header.',
  },
  roster: {
    title: 'Roster size',
    what: 'How many players the typical program carries in this segment.',
    read: 'The dot is the median program; the band spans the middle-half of programs.',
    source: 'Median across programs (not players).',
  },
  position: {
    title: 'Position composition',
    what: 'The share of a typical program’s roster at each position, paired with the raw player count.',
    read: 'Bars are the median program’s share; “· N” is the median number of players. These are per-program medians, so they needn’t sum to exactly 100%.',
    source: 'Programs with at least nine classified players. Median across programs.',
  },
  class: {
    title: 'Class composition',
    what: 'The share of a typical roster in each class year, paired with the raw player count.',
    read: 'Bars are the median program’s share; “· N” is the median number of players.',
    source: 'Programs with at least nine classified players. Median across programs.',
  },
  geography: {
    title: 'Recruiting geography',
    what: 'Where players come from — the recruiting footprint of this segment.',
    read: 'Darker regions send more players. Toggle U.S. / World; the ranked lists show the top origins.',
    source: 'Player-level counts, pooled across programs.',
  },
  retention: {
    title: 'Retention',
    what: 'How much of the roster returns year over year, and how many players are new.',
    read: 'Return rate is the share of last season’s players still on the roster; newcomer rate is the share who are new.',
    source: 'Needs a prior season, so 2021 has none. JC is excluded — it’s always a stop, not a destination.',
  },
}

export const TREND_INFO = {
  size: {
    title: 'Height by position, over time',
    what: 'How median height at each position has moved across seasons.',
    read: 'The line is the median each season; the shaded band is the middle-half (p25–p75). The big number is the latest season, with the change since the first tracked season.',
    source: 'Player-level per season.',
  },
  roster: {
    title: 'Roster size, over time',
    what: 'How the typical roster size has moved across seasons.',
    read: 'Line = median program each season; band = middle-half of programs. The big number is the latest season, with the change since the first.',
    source: 'Median across programs.',
  },
  position: {
    title: 'Position mix, over time',
    what: 'How the roster’s position mix shifts season by season.',
    read: 'Each column is a season; segment heights are the typical program’s composition (median counts stacked). Tap a season to read each group’s share and player count.',
    source: 'Programs with at least nine classified players.',
  },
  class: {
    title: 'Class mix, over time',
    what: 'How the roster’s class mix shifts season by season.',
    read: 'Each column is a season; segment heights are the typical program’s composition (median counts stacked). Tap a season to read each group’s share and player count.',
    source: 'Programs with at least nine classified players.',
  },
  retention: {
    title: 'Retention, over time',
    what: 'How return and newcomer rates have moved across seasons.',
    read: 'Line = median rate each season; band = middle-half. Retention needs a prior season, so it starts at 2022.',
    source: 'JC is excluded.',
  },
  geography: {
    title: 'Recruiting geography, over time',
    what: 'Where players come from and how the footprint is shifting.',
    read: 'A footprint map across the seasons plus the domestic-vs-international trend — arriving in the next pass.',
    source: 'Player-level counts per season.',
  },
}

export const COMPARE_INFO = {
  height: {
    title: 'Height by position',
    what: 'The height distribution at each position, laid over your segments together.',
    read: 'Each curve is a segment’s distribution; the dashed line and the value on the right are that segment’s median. Hover a segment to isolate it.',
    source: 'Player-level, from the benchmark histograms.',
  },
  roster: {
    title: 'Roster size',
    what: 'The typical roster size in each segment.',
    read: 'A longer bar is a larger median roster.',
    source: 'Median across programs.',
  },
  intl: {
    title: '% International',
    what: 'The typical program’s share of international players in each segment.',
    read: 'Median program share. A blank bar means the metric isn’t available for that segment.',
    source: 'Median across programs.',
  },
  position: {
    title: 'Position mix',
    what: 'The typical program’s position composition in each segment, with raw counts.',
    read: 'For each position, one bar per segment; “· N” is the median player count.',
    source: 'Programs with at least nine classified players.',
  },
  class: {
    title: 'Class mix',
    what: 'The typical program’s class composition in each segment, with raw counts.',
    read: 'For each class year, one bar per segment; “· N” is the median player count.',
    source: 'Programs with at least nine classified players.',
  },
  retention: {
    title: 'Retention',
    what: 'Return and newcomer rates in each segment.',
    read: 'Higher return means more continuity. No 2021, and none for JC.',
    source: 'Median across programs.',
  },
}
