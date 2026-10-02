import { summariseTransfers } from './data/transferSummary'
import { divShort, genderLabel } from './data/landscapeFormat'

/**
 * TransferFlows — item 4 of the transfer-display plan (Damon, 2026-09-29): where
 * traced transfers INTO the selected division came from, where players who
 * LEFT it went, and its strongest conference-to-conference corridors.
 *
 * Division to division is the primary view: conference-level flows keep only
 * about a quarter of the movement once flows under 3 are suppressed, so they are
 * shown as "strongest corridors", never as a complete map.
 *
 * TRACED ONLY. These are player_transfers moves, which cover about two in five
 * experienced newcomers (41.6%, measured 2026-10-02). The copy says so; the bars
 * are the known part of the movement, not all of it.
 */
function commas(n) { return Math.round(n).toLocaleString('en-US') }
function share(n, total) { return total ? `${Math.round((100 * n) / total)}%` : '—' }
function divName(d) { return d === 'JC' ? 'JC' : divShort(d) }
function confName(c) { return c === '(none)' ? 'No conference' : c }

function FlowBars({ items, total, division, sameLabel }) {
  if (!items.length) return <p className="csl-empty">None recorded.</p>
  const max = Math.max(...items.map(i => i.n))
  return (
    <div className="csl-bars">
      {items.map(i => (
        <div className="csl-bar-row csl-xfer-row" key={i.group}>
          <span className="csl-bar-label">{i.group === division ? sameLabel : divName(i.group)}</span>
          <div className="csl-bar-track">
            <div className="csl-bar-fill" style={{ width: `${(100 * i.n) / max}%` }} />
          </div>
          <span className="csl-bar-val"><span className="csl-bv-med"><b>{commas(i.n)}</b> <i className="csl-iqrtext">{share(i.n, total)}</i></span></span>
        </div>
      ))}
    </div>
  )
}

export default function TransferFlows({ transfers, division, gender, season }) {
  if (transfers.loading) return <p className="csl-empty">Loading transfers…</p>
  if (transfers.error) return <p className="csl-empty">Couldn’t load transfers.</p>

  const s = summariseTransfers(transfers.rows, { division, season, seasons: transfers.seasons })
  const seg = `${divShort(division)} ${genderLabel(gender)}`
  const inTotal = s.into.reduce((a, i) => a + i.n, 0)
  const outTotal = s.outOf.reduce((a, i) => a + i.n, 0)
  const same = `Other ${divName(division)}`
  const span = transfers.seasons.length
    ? (s.pooled
        ? `arrivals in ${transfers.seasons.join(' and ')}`
        : `arrivals in ${s.season}`)
    : ''

  if (!inTotal && !outTotal) {
    return <p className="csl-empty">No traced transfers are recorded for {seg}{span ? ` (${span})` : ''}.</p>
  }

  const { up, lateral, down } = s.moves
  const moveBits = [
    up ? `${commas(up)} moved up` : null,
    lateral ? `${commas(lateral)} moved across` : null,
    down ? `${commas(down)} moved down` : null,
  ].filter(Boolean)

  return (
    <div className="csl-xfer">
      <p className="csl-xfer-lede">
        Traced moves between college programs, {span}
        {s.pooled && transfers.seasons.length > 0 && season !== 0 && !transfers.seasons.includes(season)
          ? ` — transfers are tracked for ${transfers.seasons.join(' and ')} only, so both are shown`
          : ''}.
      </p>

      <div className="csl-xfer-grid">
        <div>
          <h3 className="csl-xfer-h">Came from <span className="csl-xfer-n">{commas(inTotal)} into {seg}</span></h3>
          <FlowBars items={s.into} total={inTotal} division={division} sameLabel={same} />
          {moveBits.length > 0 && <p className="csl-xfer-sum">{moveBits.join(' · ')}.</p>}
        </div>
        <div>
          <h3 className="csl-xfer-h">Went to <span className="csl-xfer-n">{commas(outTotal)} out of {seg}</span></h3>
          <FlowBars items={s.outOf} total={outTotal} division={division} sameLabel={same} />
        </div>
      </div>

      {s.corridors.length > 0 && (
        <div className="csl-xfer-corr">
          <h3 className="csl-xfer-h">Strongest conference corridors</h3>
          <ol className="csl-corr">
            {s.corridors.map((c, i) => (
              <li key={i}>
                <span className="csl-corr-path">
                  {confName(c.from_group)}
                  {c.from_division !== division && <em> {divName(c.from_division)}</em>}
                  <span className="csl-corr-arrow" aria-label="to"> → </span>
                  {confName(c.to_group)}
                  {c.to_division !== division && <em> {divName(c.to_division)}</em>}
                </span>
                <b className="csl-corr-n">{commas(c.n)}</b>
              </li>
            ))}
          </ol>
        </div>
      )}

      <p className="csl-note">
        Only traced transfers are counted. About two in five players who arrive with college
        experience can be matched to a previous program, so these show the known part of the movement,
        not all of it. Flows of fewer than 3 players are not shown.
      </p>
    </div>
  )
}
