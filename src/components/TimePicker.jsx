import { useEffect, useState } from 'react'

/**
 * Friendly AM/PM time picker.
 *
 * Replaces native <input type="time"> which has fiddly UX on Safari.
 *
 * Props:
 *   value     – string in 24-hour HH:MM format ('14:30') or '' if empty
 *   onChange  – called with new 24-hour HH:MM string
 *   id        – optional id attribute (also used as aria reference)
 *
 * Renders three dropdowns: Hour (1-12), Minute (00/15/30/45), AM/PM.
 * If `value` is empty, all three start blank and onChange only fires
 * once the user has picked all three.
 */
export default function TimePicker({ value, onChange, id }) {
  // Parse incoming 24-hour value into 12-hour parts
  const parse = (v) => {
    if (!v) return { hour12: '', minute: '', period: '' }
    const [h, m] = v.split(':').map((s) => parseInt(s, 10))
    if (isNaN(h) || isNaN(m)) return { hour12: '', minute: '', period: '' }
    const period = h >= 12 ? 'PM' : 'AM'
    const hour12 = h % 12 || 12
    return {
      hour12: String(hour12),
      minute: String(m).padStart(2, '0'),
      period,
    }
  }

  const initial = parse(value)
  const [hour12, setHour12] = useState(initial.hour12)
  const [minute, setMinute] = useState(initial.minute)
  const [period, setPeriod] = useState(initial.period)

  // Sync from value prop changes (e.g. parent reset)
  useEffect(() => {
    const parsed = parse(value)
    setHour12(parsed.hour12)
    setMinute(parsed.minute)
    setPeriod(parsed.period)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  // Emit composed value when all three are set; emit '' if any is missing
  const emit = (h, m, p) => {
    if (!h || !m || !p) {
      if (value) onChange('')
      return
    }
    let h24 = parseInt(h, 10) % 12
    if (p === 'PM') h24 += 12
    const newValue = `${String(h24).padStart(2, '0')}:${m}`
    if (newValue !== value) onChange(newValue)
  }

  const handleHourChange = (e) => {
    const v = e.target.value
    setHour12(v)
    emit(v, minute, period)
  }
  const handleMinuteChange = (e) => {
    const v = e.target.value
    setMinute(v)
    emit(hour12, v, period)
  }
  const handlePeriodChange = (e) => {
    const v = e.target.value
    setPeriod(v)
    emit(hour12, minute, v)
  }

  const handleClear = () => {
    setHour12('')
    setMinute('')
    setPeriod('')
    onChange('')
  }

  const baseSelectClasses =
    'px-2 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500'

  return (
    <div className="flex items-center gap-1" id={id}>
      <select
        aria-label="Hour"
        value={hour12}
        onChange={handleHourChange}
        className={baseSelectClasses}
      >
        <option value="">Hour</option>
        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((h) => (
          <option key={h} value={h}>
            {h}
          </option>
        ))}
      </select>
      <span className="text-gray-500 font-medium">:</span>
      <select
        aria-label="Minute"
        value={minute}
        onChange={handleMinuteChange}
        className={baseSelectClasses}
      >
        <option value="">Min</option>
        {['00', '05', '10', '15', '20', '25', '30', '35', '40', '45', '50', '55'].map(
          (m) => (
            <option key={m} value={m}>
              {m}
            </option>
          )
        )}
      </select>
      <select
        aria-label="AM or PM"
        value={period}
        onChange={handlePeriodChange}
        className={baseSelectClasses}
      >
        <option value="">--</option>
        <option value="AM">AM</option>
        <option value="PM">PM</option>
      </select>
      {value && (
        <button
          type="button"
          onClick={handleClear}
          aria-label="Clear time"
          className="text-gray-400 hover:text-gray-700 text-xs px-2 py-1"
          title="Clear time"
        >
          Clear
        </button>
      )}
    </div>
  )
}
