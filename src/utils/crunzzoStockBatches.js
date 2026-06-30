export const EXPIRY_ALERT_WINDOW_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfLocalDayMs(value = Date.now()) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

export function getTodayDateInputValue() {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function parseStockExpiryDate(value) {
  const raw = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;

  const date = new Date(`${raw}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

export function formatStockExpiryDate(value) {
  const date = parseStockExpiryDate(value);
  if (!date) return "-";

  return date.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function getStockBatchRemainingUnits(batch) {
  const remaining = Number(batch?.remainingUnits ?? batch?.units ?? 0);
  return Number.isFinite(remaining) ? Math.max(0, remaining) : 0;
}

export function normalizeStockBatches(productOrBatches) {
  const batches = Array.isArray(productOrBatches)
    ? productOrBatches
    : Array.isArray(productOrBatches?.stockBatches)
      ? productOrBatches.stockBatches
      : [];

  return batches
    .map((batch, index) => {
      const expiryDate = String(batch?.expiryDate || "").trim();
      const parsedExpiry = parseStockExpiryDate(expiryDate);
      const units = Math.max(0, Number(batch?.units || 0));
      const remainingUnits = getStockBatchRemainingUnits(batch);

      if (!parsedExpiry || remainingUnits <= 0) return null;

      return {
        ...batch,
        id: batch?.id || `batch-${index}`,
        expiryDate,
        expiryDateMs: parsedExpiry.getTime(),
        units,
        remainingUnits,
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      const expiryDiff = Number(a.expiryDateMs || 0) - Number(b.expiryDateMs || 0);
      if (expiryDiff) return expiryDiff;
      return Number(a.receivedAtMs || 0) - Number(b.receivedAtMs || 0);
    });
}

export function buildStockBatch({ productId = "", productName = "", skuCode = "", units, expiryDate }) {
  const parsedExpiry = parseStockExpiryDate(expiryDate);
  const safeUnits = Math.max(0, Number(units || 0));
  const nowMs = Date.now();

  return {
    id: `${nowMs}-${Math.random().toString(36).slice(2, 8)}`,
    productId,
    productName,
    skuCode,
    units: safeUnits,
    remainingUnits: safeUnits,
    expiryDate,
    expiryDateMs: parsedExpiry ? parsedExpiry.getTime() : 0,
    receivedAtMs: nowMs,
  };
}

export function appendStockBatch(existingBatches, batch) {
  if (!batch || getStockBatchRemainingUnits(batch) <= 0) {
    return normalizeStockBatches(existingBatches);
  }

  return normalizeStockBatches([...normalizeStockBatches(existingBatches), batch]);
}

export function reconcileStockBatchesToStock(existingBatches, targetUnits) {
  const target = Math.max(0, Number(targetUnits || 0));
  let remainingTarget = target;

  return normalizeStockBatches(existingBatches)
    .map((batch) => {
      const remainingUnits = Math.min(getStockBatchRemainingUnits(batch), remainingTarget);
      remainingTarget -= remainingUnits;
      return {
        ...batch,
        remainingUnits,
      };
    })
    .filter((batch) => getStockBatchRemainingUnits(batch) > 0);
}

export function deductStockBatches(existingBatches, unitsToDeduct) {
  let unitsLeft = Math.max(0, Number(unitsToDeduct || 0));

  return normalizeStockBatches(existingBatches)
    .map((batch) => {
      if (unitsLeft <= 0) return batch;

      const currentRemaining = getStockBatchRemainingUnits(batch);
      const usedUnits = Math.min(currentRemaining, unitsLeft);
      unitsLeft -= usedUnits;

      return {
        ...batch,
        remainingUnits: currentRemaining - usedUnits,
      };
    })
    .filter((batch) => getStockBatchRemainingUnits(batch) > 0);
}

export function getExpiringStockBatches(product, nowMs = Date.now()) {
  const todayMs = startOfLocalDayMs(nowMs);
  const alertLimitMs = todayMs + EXPIRY_ALERT_WINDOW_DAYS * DAY_MS;

  return normalizeStockBatches(product)
    .filter((batch) => Number(batch.expiryDateMs || 0) <= alertLimitMs)
    .map((batch) => {
      const daysUntilExpiry = Math.ceil((Number(batch.expiryDateMs || 0) - todayMs) / DAY_MS);
      const expired = daysUntilExpiry < 0;

      return {
        ...batch,
        daysUntilExpiry,
        expired,
      };
    });
}

export function getNextStockExpiryBatch(product) {
  return normalizeStockBatches(product)[0] || null;
}
