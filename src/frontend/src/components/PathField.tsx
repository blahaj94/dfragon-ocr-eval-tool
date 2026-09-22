export function PathField({
  id,
  label,
  value,
  placeholder,
  disabled,
  onChoose
}: {
  id: string
  label: string
  value: string
  placeholder: string
  disabled: boolean
  onChoose: () => void
}): React.JSX.Element {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="path-control">
        <input id={id} value={value} readOnly placeholder={placeholder} title={value} />
        <button
          type="button"
          className="button button-secondary"
          disabled={disabled}
          onClick={onChoose}
          aria-label={`${label} 선택`}
        >
          찾아보기
        </button>
      </div>
    </div>
  )
}
