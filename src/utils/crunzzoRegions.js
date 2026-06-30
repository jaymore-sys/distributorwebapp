export const CRUNZZO_REGIONS = [
  { id: "chennai", name: "Chennai" },
  { id: "mumbai", name: "Coimbatore", aliases: ["mumbai"] },
  { id: "delhi", name: "Puttur", aliases: ["delhi"] },
];

export const CRUNZZO_REQUEST_STATUS = {
  PENDING: "pending",
  APPROVED: "approved",
  PAYMENT_RECEIVED: "payment_received",
  SHIPPED: "shipped",
};

export function normalizeCrunzzoRegion(value, fallback = "Chennai") {
  const normalized = String(value || "").trim().toLowerCase();
  const match = CRUNZZO_REGIONS.find((region) => {
    const candidates = [region.id, region.name, ...(region.aliases || [])]
      .map((item) => String(item || "").trim().toLowerCase())
      .filter(Boolean);

    return candidates.some(
      (candidate) => normalized === candidate || normalized.includes(candidate)
    );
  });

  if (match) return match.name;
  return fallback;
}

export function getCrunzzoRegionId(value) {
  const regionName = normalizeCrunzzoRegion(value, "");
  return CRUNZZO_REGIONS.find((region) => region.name === regionName)?.id || "";
}

export function getCrunzzoUserRegion(profile, fallback = "Chennai") {
  return normalizeCrunzzoRegion(
    profile?.region || profile?.territory || profile?.zone,
    fallback
  );
}

export function getRegionalRemainingUnits(allocation) {
  return Math.max(
    0,
    Number(allocation?.allocatedUnits || 0) - Number(allocation?.fulfilledUnits || 0)
  );
}

export function getRequestStatusLabel(status) {
  switch (status) {
    case CRUNZZO_REQUEST_STATUS.APPROVED:
      return "Approved";
    case CRUNZZO_REQUEST_STATUS.PAYMENT_RECEIVED:
      return "Payment Received";
    case CRUNZZO_REQUEST_STATUS.SHIPPED:
      return "Shipped";
    default:
      return "Pending Approval";
  }
}

export function getRequestStatusColor(status) {
  switch (status) {
    case CRUNZZO_REQUEST_STATUS.APPROVED:
      return "#2563eb";
    case CRUNZZO_REQUEST_STATUS.PAYMENT_RECEIVED:
      return "#b45309";
    case CRUNZZO_REQUEST_STATUS.SHIPPED:
      return "#16803a";
    default:
      return "#d42424";
  }
}
