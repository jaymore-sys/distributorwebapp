export default function CategoryModal({
  open,
  value,
  error,
  confirmClassName = "",
  onChange,
  onClose,
  onSubmit,
}) {
  if (!open) return null;

  return (
    <div className="app-modal-overlay" onClick={onClose}>
      <form className="app-modal" onClick={(event) => event.stopPropagation()} onSubmit={onSubmit}>
        <h3>Add New Category</h3>
        <p>Create a category for this product list. It will be selected automatically.</p>

        <label>
          Category Name
          <input
            type="text"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder="e.g. Premium Snacks"
            autoFocus
          />
        </label>

        {error ? <div className="app-modal-error">{error}</div> : null}

        <div className="app-modal-actions">
          <button type="button" className="crz-logout-cancel" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={`crz-logout-confirm ${confirmClassName}`}>
            Add
          </button>
        </div>
      </form>
    </div>
  );
}
