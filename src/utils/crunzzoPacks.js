export const CRUNZZO_PACKS = [
  { id: "pack12", label: "Pack of 12", packSize: 12, defaultLowStockThreshold: 20 },
  { id: "pack240", label: "Pack of 240", packSize: 240, defaultLowStockThreshold: 2 },
];

export function toNumber(value, fallback = 0) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

export function normalizeCrunzzoPackOptions(product = {}) {
  const savedOptions = Array.isArray(product.packOptions) ? product.packOptions : [];
  const legacyRate = toNumber(product.rate || product.price, 0);
  const legacyGst = toNumber(product.gst, 18);
  const legacyStock = toNumber(product.stock, 0);

  return CRUNZZO_PACKS.map((pack) => {
    const saved =
      savedOptions.find((item) => item.id === pack.id) ||
      savedOptions.find((item) => Number(item.packSize || item.units) === pack.packSize) ||
      {};

    const fallbackRate = legacyRate > 0 ? legacyRate * pack.packSize : 0;
    const fallbackStock = legacyStock > 0 ? Math.floor(legacyStock / pack.packSize) : 0;

    return {
      id: pack.id,
      label: saved.label || pack.label,
      packSize: pack.packSize,
      rate: toNumber(saved.rate ?? saved.price, fallbackRate),
      price: toNumber(saved.rate ?? saved.price, fallbackRate),
      pricingGroup: saved.pricingGroup || product.pricingGroup || "Standard Retail",
      gst: toNumber(saved.gst, legacyGst),
      stock: toNumber(saved.stock ?? saved.quantity, fallbackStock),
      lowStockThreshold: toNumber(
        saved.lowStockThreshold,
        pack.defaultLowStockThreshold
      ),
    };
  });
}

export function buildCrunzzoPackOptionsFromForm(form) {
  return CRUNZZO_PACKS.map((pack) => ({
    id: pack.id,
    label: pack.label,
    packSize: pack.packSize,
    rate: toNumber(form[`${pack.id}Rate`], 0),
    price: toNumber(form[`${pack.id}Rate`], 0),
    pricingGroup: form[`${pack.id}PricingGroup`] || form.pricingGroup || "Standard Retail",
    gst: toNumber(form[`${pack.id}Gst`], 18),
    stock: toNumber(form[`${pack.id}Stock`], 0),
    openingStock: toNumber(form[`${pack.id}Stock`], 0),
    lowStockThreshold: toNumber(
      form[`${pack.id}LowStockThreshold`],
      pack.defaultLowStockThreshold
    ),
  }));
}

export function getCrunzzoTotalUnits(productOrOptions) {
  const packOptions = Array.isArray(productOrOptions)
    ? productOrOptions
    : normalizeCrunzzoPackOptions(productOrOptions);

  return packOptions.reduce((sum, pack) => {
    return sum + toNumber(pack.stock, 0) * toNumber(pack.packSize, 1);
  }, 0);
}

export function getCrunzzoInventoryValue(product) {
  return normalizeCrunzzoPackOptions(product).reduce((sum, pack) => {
    return sum + toNumber(pack.stock, 0) * toNumber(pack.rate || pack.price, 0);
  }, 0);
}

export function isCrunzzoLowStock(product) {
  return normalizeCrunzzoPackOptions(product).some((pack) => {
    return toNumber(pack.stock, 0) <= toNumber(pack.lowStockThreshold, 0);
  });
}
