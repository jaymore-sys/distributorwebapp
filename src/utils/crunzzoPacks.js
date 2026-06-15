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
  const totalUnits = toNumber(product.stock, 0);

  return CRUNZZO_PACKS.map((pack) => {
    const saved = savedOptions.find((item) => item.id === pack.id) || {};

    // Prioritize the saved pack size from database
    const pSize = Math.max(1, toNumber(saved.packSize || saved.units, pack.packSize));

    const fallbackRate = legacyRate > 0 ? legacyRate * pSize : 0;

    // Displayed pack count is floor of total units / pack size
    const packCount = Math.floor(totalUnits / pSize);

    return {
      id: pack.id,
      label: `Pack of ${pSize}`,
      packSize: pSize,
      rate: toNumber(saved.rate ?? saved.price, fallbackRate),
      price: toNumber(saved.rate ?? saved.price, fallbackRate),
      pricingGroup: saved.pricingGroup || product.pricingGroup || "Standard Retail",
      gst: toNumber(saved.gst, legacyGst),
      stock: packCount, // This is used for "X packs" display
      lowStockThreshold: toNumber(
        product.lowStockThreshold,
        pack.defaultLowStockThreshold
      ),
    };
  });
}

export function buildCrunzzoPackOptionsFromForm(form) {
  const sharedGst = toNumber(form.gst, 18);
  const totalUnits = toNumber(form.stock, 0);
  const sharedLowStock = toNumber(form.lowStockThreshold, 0);

  return CRUNZZO_PACKS.map((pack) => {
    const pSize = Math.max(1, toNumber(form[`${pack.id}Size`], pack.packSize));
    return {
      id: pack.id,
      label: `Pack of ${pSize}`,
      packSize: pSize,
      rate: toNumber(form[`${pack.id}Rate`], 0),
      price: toNumber(form[`${pack.id}Rate`], 0),
      pricingGroup: form[`${pack.id}PricingGroup`] || form.pricingGroup || "Standard Retail",
      gst: sharedGst,
      stock: Math.floor(totalUnits / pSize),
      openingStock: Math.floor(totalUnits / pSize),
      lowStockThreshold: sharedLowStock,
    };
  });
}

export function getCrunzzoTotalUnits(productOrOptions) {
  // If it's a product object, return its stock field directly
  if (productOrOptions && !Array.isArray(productOrOptions) && productOrOptions.stock !== undefined) {
    return toNumber(productOrOptions.stock, 0);
  }

  // If we only have packOptions (array), we must return the floor-derived sum
  // Note: We should prefer passing the full product object to this function
  if (Array.isArray(productOrOptions)) {
    return productOrOptions.reduce((sum, pack) => {
      return sum + toNumber(pack.stock, 0) * toNumber(pack.packSize, 1);
    }, 0);
  }

  return 0;
}

export function getCrunzzoInventoryValue(product) {
  const totalUnits = getCrunzzoTotalUnits(product);
  const options = normalizeCrunzzoPackOptions(product);
  if (options.length === 0) return 0;

  // Use the price of the first pack (Standard Retail) to determine unit value
  const primary = options[0];
  const unitPrice = toNumber(primary.rate || primary.price, 0) / Math.max(1, primary.packSize);

  return totalUnits * unitPrice;
}

export function isCrunzzoLowStock(product) {
  const totalUnits = getCrunzzoTotalUnits(product);
  const threshold = toNumber(product.lowStockThreshold, 0);
  return totalUnits <= threshold;
}
