/**
 * Date input with consistent empty-state styling.
 *
 * When empty: orange border + light orange fill, italic helper text below.
 * When filled: normal border, normal text color.
 *
 * Used everywhere in the app so date fields behave the same way:
 * the placeholder ("mm/dd/yyyy") never looks like real data.
 *
 * Props:
 *   label       — field label
 *   value       — the date string (YYYY-MM-DD) or ''
 *   onChange    — onChange handler from parent
 *   required    — appends an asterisk to label and enforces HTML required
 *   helper      — optional override of the empty-state helper text
 *   min, max    — passed through to the input
 */
export default function DateField({
  label,
  value,
  onChange,
  required = false,
  helper = 'Tap to pick a date — none selected yet',
  min,
  max,
}) {
  const empty = !value
  return (
    <div>
      <label className="block text-sm text-gray-600 mb-1">
        {label}
        {required && ' *'}
      </label>
      <input
        type="date"
        value={value || ''}
        onChange={onChange}
        min={min}
        max={max}
        required={required}
        className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${
          empty
            ? 'border-orange-300 bg-orange-50 text-gray-500'
            : 'border-gray-300 text-gray-900'
        }`}
      />
      {empty && (
        <p className="text-xs text-orange-600 italic mt-1">{helper}</p>
      )}
    </div>
  )
}
