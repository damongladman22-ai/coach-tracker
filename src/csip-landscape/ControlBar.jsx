import {
  DIVISIONS, GENDERS, SEASONS, FAMILIES, divShort,
} from './data/landscapeFormat'

/**
 * ControlBar — the persistent selection surface shared by all three lenses.
 * Carries division × gender × season × family, plus the lens switcher. Sticky
 * so the selection stays in reach as the body scrolls.
 *
 * Props:
 *   selection = { division, gender, season, family, lens }
 *   set(patch)      — merge-updates the selection
 *   onFamily(key)   — family chip clicked (parent sets family + scrolls to anchor)
 */
const LENSES = [
  { key: 'profile', label: 'Profile' },
  { key: 'compare', label: 'Compare' },
  { key: 'trend', label: 'Trend' },
]

function Seg({ options, value, onChange, getKey, getLabel }) {
  return (
    <div className="csl-seg" role="group">
      {options.map(o => {
        const k = getKey(o)
        const active = k === value
        return (
          <button
            key={String(k)}
            type="button"
            className={active ? 'csl-seg-btn csl-seg-btn--on' : 'csl-seg-btn'}
            aria-pressed={active}
            onClick={() => onChange(k)}
          >
            {getLabel(o)}
          </button>
        )
      })}
    </div>
  )
}

export default function ControlBar({ selection, set, onFamily }) {
  const { division, gender, season, family, lens } = selection

  return (
    <div className="csl-controls">
      <div className="csl-controls-inner">
        <div className="csl-cb-identity">
          <div className="csl-cb-group">
            <span className="csl-cb-label">Division</span>
            <Seg
              options={DIVISIONS}
              value={division}
              onChange={v => set({ division: v })}
              getKey={d => d}
              getLabel={d => divShort(d)}
            />
          </div>
          <div className="csl-cb-group">
            <span className="csl-cb-label">Gender</span>
            <Seg
              options={GENDERS}
              value={gender}
              onChange={v => set({ gender: v })}
              getKey={g => g.key}
              getLabel={g => g.label}
            />
          </div>
          {lens !== 'trend' && (
            <div className="csl-cb-group">
              <span className="csl-cb-label">Season</span>
              <Seg
                options={SEASONS}
                value={season}
                onChange={v => set({ season: v })}
                getKey={s => s.key}
                getLabel={s => s.label}
              />
            </div>
          )}
        </div>

        <div className="csl-cb-lower">
          <div className="csl-lenstabs" role="tablist">
            {LENSES.map(l => (
              <button
                key={l.key}
                type="button"
                role="tab"
                aria-selected={l.key === lens}
                className={l.key === lens ? 'csl-lenstab csl-lenstab--on' : 'csl-lenstab'}
                onClick={() => set({ lens: l.key })}
              >
                {l.label}
              </button>
            ))}
          </div>

          <div className="csl-cb-jump">
            <span className="csl-cb-label csl-cb-label--jump">
              {lens === 'profile' ? 'Jump to' : 'Metric'}
            </span>
            <div className="csl-familychips">
              {FAMILIES.map(f => (
                <button
                  key={f.key}
                  type="button"
                  className={f.key === family ? 'csl-fchip csl-fchip--on' : 'csl-fchip'}
                  onClick={() => onFamily(f.key)}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
