export default function AdminProductEditPanel({
  form,
  onChange,
  onSave,
  onCancel,
  saving,
  brand,
  text,
  muted,
  border,
}) {
  const inputStyle = {
    width: "100%",
    height: 44,
    borderRadius: 12,
    border: `1px solid ${border}`,
    padding: "0 12px",
    outline: "none",
    background: "#fff",
    color: text,
    fontSize: 14,
    fontWeight: 700,
    boxSizing: "border-box",
  };

  const labelStyle = {
    display: "grid",
    gap: 6,
    color: text,
    fontSize: 12,
    fontWeight: 900,
  };

  return (
    <div
      style={{
        marginTop: 14,
        padding: 12,
        border: `1px solid ${border}`,
        borderRadius: 14,
        background: "#fafafa",
        display: "grid",
        gap: 12,
        boxSizing: "border-box",
      }}
    >
      <label style={labelStyle}>
        Product Name
        <input
          name="name"
          value={form.name}
          onChange={onChange}
          placeholder="Product name"
          style={inputStyle}
        />
      </label>

      <label style={labelStyle}>
        Original Price
        <input
          name="rate"
          value={form.rate}
          onChange={onChange}
          placeholder="Original price"
          inputMode="numeric"
          style={inputStyle}
        />
      </label>

      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          style={{
            height: 34,
            padding: "0 12px",
            borderRadius: 999,
            border: `1px solid ${border}`,
            background: "#fff",
            color: muted,
            fontWeight: 800,
            cursor: saving ? "not-allowed" : "pointer",
          }}
        >
          Cancel
        </button>

        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          style={{
            height: 34,
            padding: "0 14px",
            borderRadius: 999,
            border: "none",
            background: brand,
            color: "#fff",
            fontWeight: 900,
            cursor: saving ? "not-allowed" : "pointer",
            opacity: saving ? 0.7 : 1,
          }}
        >
          {saving ? "Saving..." : "Save"}
        </button>
      </div>
    </div>
  );
}
