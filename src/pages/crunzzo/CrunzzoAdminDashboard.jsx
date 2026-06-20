import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { onAuthStateChanged, signOut } from "firebase/auth";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import crunzzoLogo from "../../assets/crunzzologo.png";
import AdminProfileEditor from "../../components/AdminProfileEditor";
import CategoryModal from "../../components/CategoryModal";
import { getFirebaseServices } from "../../firebase";
import { routeToChooseSelection, usePortalHistoryManager } from "../../navigation/globalNavigationManager";
import {
  CRUNZZO_PACKS,
  buildCrunzzoPackOptionsFromForm,
  getCrunzzoInventoryValue,
  getCrunzzoTotalUnits,
  isCrunzzoLowStock,
  normalizeCrunzzoPackOptions,
  toNumber,
} from "../../utils/crunzzoPacks";
import HistoryDateFilter, { getFilterLabel, getFilterHeading } from "../../components/HistoryDateFilter";
import {
  CRUNZZO_REGIONS,
  getCrunzzoUserRegion,
  getRegionalRemainingUnits,
} from "../../utils/crunzzoRegions";
import {
  buildNotificationBody,
  isAppNotificationViewed,
  markAppNotificationViewed,
  mergeAppNotifications,
  subscribeToAppNotifications,
  syncComputedAppNotifications,
} from "../../utils/appNotifications";

const { auth, db, storage } = getFirebaseServices("crunzzo");

const BRAND = "#e51f28";
const TEXT = "#20263a";
const MUTED = "#7d879b";
const BG = "#f6f6f6";
const CARD = "#ffffff";
const BORDER = "#ececec";
const PRODUCT_LABEL_STYLE = {
  fontSize: 13,
  fontWeight: 900,
  color: TEXT,
  lineHeight: 1.25,
  overflowWrap: "anywhere",
};
const PRODUCT_FIELD_TEXT_STYLE = {
  width: "100%",
  maxWidth: "100%",
  boxSizing: "border-box",
  fontSize: 14,
  fontWeight: 700,
  color: TEXT,
};

const ZONES = ["Chennai", "Hyderabad", "Tamil Nadu", "Karnataka"];
const CATEGORY_OPTIONS = ["Chips", "Puffs", "Namkeen", "Masala", "Snacks"];
const ADD_CATEGORY_VALUE = "__add_new_category__";
const PRICING_GROUPS = ["Standard Retail", "Wholesale", "Distributor"];
const PINCODE_CITY_CACHE_KEY = "crunzzo_pincode_city_cache_v1";
const ADMIN_VIEWED_NOTIFICATIONS_KEY = "crunzzo_admin_viewed_notifications_v1";
const PINCODE_CITY_OVERRIDES = {
  "400086": "Ghatkopar West",
  "400088": "Govandi",
  "400097": "Malad East",
};
const EMPTY_SKU_STAT = {
  productId: "",
  name: "No sales yet",
  category: "",
  imageUrl: "",
  units: 0,
  salesValue: 0,
};

function formatRupees(value) {
  return `₹${Number(value || 0).toLocaleString("en-IN", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  })}`;
}

function formatCompact(value) {
  const n = Number(value || 0);
  if (n >= 10000000) return `₹${(n / 10000000).toFixed(1).replace(".0", "")}Cr`;
  if (n >= 100000) return `₹${(n / 100000).toFixed(1).replace(".0", "")}L`;
  if (n >= 1000) return `₹${(n / 1000).toFixed(1).replace(".0", "")}K`;
  return `₹${n}`;
}

function sanitizeNumber(value) {
  let cleaned = value.replace(/[^\d]/g, "");
  if (cleaned.length > 1 && cleaned.startsWith("0")) {
    cleaned = cleaned.replace(/^0+/, "");
  }
  return cleaned;
}

function formatTime(value) {
  if (!value) return "-";
  try {
    const date = new Date(value);
    return date.toLocaleString("en-IN", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "-";
  }
}

function isValidPincode(value) {
  return /^\d{6}$/.test(String(value || "").trim());
}

function readPincodeCityCache() {
  if (typeof window === "undefined") return {};

  try {
    const saved = window.localStorage.getItem(PINCODE_CITY_CACHE_KEY);
    return saved ? JSON.parse(saved) : {};
  } catch {
    return {};
  }
}

function savePincodeCityCache(cache) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(PINCODE_CITY_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // Cache failures should never block dashboard data.
  }
}

function readStoredIdMap(key) {
  if (typeof window === "undefined") return {};
  try {
    const saved = window.localStorage.getItem(key);
    return saved ? JSON.parse(saved) : {};
  } catch {
    return {};
  }
}

function saveStoredIdMap(key, value) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Notification read state is a convenience and should not block the dashboard.
  }
}

function getPincodeCityFromResponse(data) {
  const postOffices = Array.isArray(data?.[0]?.PostOffice) ? data[0].PostOffice : [];
  const office =
    postOffices.find((item) => String(item?.DeliveryStatus || "").toLowerCase() === "delivery") ||
    postOffices[0];

  return String(office?.Name || office?.Block || office?.District || "").trim();
}

async function fetchPincodeCity(pincode) {
  const response = await fetch(`https://api.postalpincode.in/pincode/${pincode}`);
  if (!response.ok) return "";

  const data = await response.json();
  return getPincodeCityFromResponse(data);
}

function formatPincodeLabel(pincode, cityLookup = {}, savedCity = "") {
  const normalized = String(pincode || "").trim();
  if (!normalized || normalized.toLowerCase() === "unassigned") return "Unassigned";

  const city = PINCODE_CITY_OVERRIDES[normalized] || savedCity || cityLookup[normalized] || "";
  return city ? `${city} - ${normalized}` : normalized;
}

function getItemUnits(item) {
  const directUnits = Number(item.totalUnits);
  if (Number.isFinite(directUnits) && directUnits > 0) return directUnits;

  const quantity = Number(item.quantity || 0);
  const packSize = Math.max(1, Number(item.packSize || item.unitCount || 1));
  return quantity * packSize;
}

function getItemSalesValue(item) {
  const lineTotal = Number(item.lineTotal);
  if (Number.isFinite(lineTotal) && lineTotal > 0) return lineTotal;

  const quantity = Number(item.quantity || 0);
  const rate = Number(item.rate || item.price || 0);
  return quantity * rate;
}

function getSkuStats(orders) {
  const map = {};
  orders.forEach((order) => {
    (order.items || []).forEach((item) => {
      const key = item.productId || String(item.name || "Unknown SKU").trim().toLowerCase();
      if (!map[key]) {
        map[key] = {
          productId: item.productId || "",
          name: item.name || "Unknown SKU",
          category: item.category || "",
          imageUrl: item.imageUrl || "",
          units: 0,
          salesValue: 0,
        };
      }
      map[key].units += getItemUnits(item);
      map[key].salesValue += getItemSalesValue(item);
    });
  });

  return Object.values(map).sort((a, b) => b.units - a.units || b.salesValue - a.salesValue);
}

function getPincodeStats(orders) {
  const map = {};
  orders.forEach((order) => {
    const pincode = String(order.salesPincode || order.pincode || "").trim() || "Unassigned";
    if (!map[pincode]) {
      map[pincode] = {
        city: "",
        value: 0,
      };
    }

    map[pincode].value += Number(order.total || 0);
    if (!map[pincode].city) {
      map[pincode].city = String(order.salesCity || order.city || order.area || order.salesZone || "").trim();
    }
  });

  const entries = Object.entries(map).sort((a, b) => b[1].value - a[1].value);
  const max = entries.length ? entries[0][1].value : 1;

  return entries.map(([name, item]) => ({
    name,
    city: item.city,
    value: item.value,
    percent: Math.max(8, Math.round((item.value / max) * 100)),
  }));
}

function isRetailerRole(value) {
  return String(value || "").toLowerCase() === "retailer";
}

function isRetailerOrder(order) {
  return Boolean(order?.retailerUid) || order?.orderType === "retailer_purchase";
}

function getSmallestPackSize(product) {
  const packSizes = normalizeCrunzzoPackOptions(product)
    .map((pack) => Number(pack.packSize || 0))
    .filter((size) => size > 0);
  return packSizes.length ? Math.min(...packSizes) : 1;
}

function AdminTab({ active, label, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        flex: "1 1 0",
        height: 40,
        border: "none",
        borderRadius: 12,
        background: active ? "#fdeeee" : "transparent",
        color: active ? BRAND : "#6d7890",
        fontWeight: 700,
        fontSize: 12,
        cursor: "pointer",
        minWidth: 0,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        padding: "0 4px",
      }}
    >
      {label}
    </button>
  );
}

function StatCard({ title, value, subtitle }) {
  return (
    <div
      style={{
        background: CARD,
        border: `1px solid ${BORDER}`,
        borderRadius: 18,
        padding: 16,
      }}
    >
      <div
        style={{
          fontSize: 11,
          color: MUTED,
          fontWeight: 700,
          textTransform: "uppercase",
        }}
      >
        {title}
      </div>
      <div style={{ marginTop: 8, fontSize: 28, fontWeight: 800, color: TEXT }}>
        {value}
      </div>
      {subtitle ? <div style={{ marginTop: 6, fontSize: 12, color: MUTED }}>{subtitle}</div> : null}
    </div>
  );
}

function SectionCard({ children, style }) {
  return (
    <div
      style={{
        background: CARD,
        border: `1px solid ${BORDER}`,
        borderRadius: 18,
        padding: 16,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export default function CrunzzoAdminDashboard() {
  const navigate = useNavigate();
  const fileInputRef = useRef(null);

  const [activeTab, setActiveTab] = useState("dashboard");
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [userProfile, setUserProfile] = useState(null);

  const [products, setProducts] = useState([]);
  const [orders, setOrders] = useState([]);
  const [users, setUsers] = useState([]);
  const [regionalAllocations, setRegionalAllocations] = useState({});
  const [loadedAllocationRegions, setLoadedAllocationRegions] = useState({});
  const [allocationDrafts, setAllocationDrafts] = useState({});
  const [allocationMessage, setAllocationMessage] = useState("");
  const [allocationSearch, setAllocationSearch] = useState("");
  const [allocationCategoryFilter, setAllocationCategoryFilter] = useState("All");
  const [expandedAllocationProductId, setExpandedAllocationProductId] = useState(null);
  const [savingAllocationId, setSavingAllocationId] = useState("");
  const [allocationErrorModal, setAllocationErrorModal] = useState(null);
  const [pincodeCityLookup, setPincodeCityLookup] = useState(readPincodeCityCache);
  const [viewedNotifications, setViewedNotifications] = useState(() =>
    readStoredIdMap(ADMIN_VIEWED_NOTIFICATIONS_KEY)
  );
  const [remoteAdminNotifications, setRemoteAdminNotifications] = useState([]);
  const [selectedNotification, setSelectedNotification] = useState(null);
  const regionalProjectionSyncKeyRef = useRef("");

  const [inventorySearch, setInventorySearch] = useState("");
  const [salesSearch, setSalesSearch] = useState("");
  const [retailerRegionFilter, setRetailerRegionFilter] = useState("all");
  const [historyFilter, setHistoryFilter] = useState("today");
  const [startDate, setStartDate] = useState(null);
  const [endDate, setEndDate] = useState(null);

  const [savingProduct, setSavingProduct] = useState(false);
  const [productMessage, setProductMessage] = useState("");
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState("");
  const [zoneInput, setZoneInput] = useState("");

  const [productForm, setProductForm] = useState({
    name: "",
    pricingGroup: "Standard Retail",
    description: "",
    skuCode: "",
    category: "Chips",
    zones: [],
    stock: "0",
    gst: "18",
    lowStockThreshold: "20",
    retailerOfferPercent: "0",
    pack12Size: "12",
    pack12PricingGroup: "Standard Retail",
    pack12Rate: "",
    pack240Size: "240",
    pack240PricingGroup: "Standard Retail",
    pack240Rate: "",
  });
  const [customCategoryOptions, setCustomCategoryOptions] = useState([]);
  const [categoryModalOpen, setCategoryModalOpen] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [newCategoryError, setNewCategoryError] = useState("");
  const [editingProductId, setEditingProductId] = useState(null);
  const [editingProductForm, setEditingProductForm] = useState({});
  const [savingProductEdit, setSavingProductEdit] = useState(false);

  const goToTab = usePortalHistoryManager({
    portalKey: "crunzzo-admin",
    basePath: "/crunzzo/admin",
    rootScreen: "dashboard",
    currentScreen: activeTab,
    setScreen: setActiveTab,
    onRootBack: () => setShowLogoutConfirm(true),
  });

  useEffect(() => {
    if (activeTab === "requests") goToTab("dashboard", { replace: true });
  }, [activeTab, goToTab]);

  useEffect(() => {
    let unsubProducts = () => {};
    let unsubOrders = () => {};
    let unsubUsers = () => {};
    const unsubAllocations = [];

    const unsubAuth = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        setUserProfile(null);
        setLoading(false);
        routeToChooseSelection(navigate);
        return;
      }

      try {
        const snap = await getDoc(doc(db, "users", user.uid));
        const profile = snap.exists() ? snap.data() : {};
        const merged = { uid: user.uid, email: user.email || "", ...profile };
        setUserProfile(merged);

        unsubProducts = onSnapshot(collection(db, "products"), (snapshot) => {
          const rows = snapshot.docs
            .map((docSnap) => ({
              id: docSnap.id,
              ...docSnap.data(),
            }))
            .sort((a, b) => Number(b.createdAtMs || 0) - Number(a.createdAtMs || 0));
          setProducts(rows);
        });

        unsubOrders = onSnapshot(collection(db, "orders"), (snapshot) => {
          const rows = snapshot.docs
            .map((docSnap) => ({
              id: docSnap.id,
              ...docSnap.data(),
            }))
            .sort((a, b) => Number(b.createdAtMs || 0) - Number(a.createdAtMs || 0));
          setOrders(rows);
        });

        unsubUsers = onSnapshot(collection(db, "users"), (snapshot) => {
          setUsers(
            snapshot.docs.map((docSnap) => ({
              id: docSnap.id,
              ...docSnap.data(),
            }))
          );
        });

        CRUNZZO_REGIONS.forEach((region) => {
          const unsubscribe = onSnapshot(
            collection(db, "regional_inventory", region.id, "products"),
            (snapshot) => {
              setRegionalAllocations((previous) => ({
                ...previous,
                [region.id]: Object.fromEntries(
                  snapshot.docs.map((item) => {
                    const allocation = item.data();
                    return [
                      allocation.productId || item.id,
                      { id: item.id, ...allocation },
                    ];
                  })
                ),
              }));
              setLoadedAllocationRegions((previous) => ({
                ...previous,
                [region.id]: true,
              }));
            }
          );
          unsubAllocations.push(unsubscribe);
        });
      } catch (error) {
        console.error("Admin auth/profile error:", error);
      } finally {
        setLoading(false);
      }
    });

    return () => {
      unsubAuth();
      unsubProducts();
      unsubOrders();
      unsubUsers();
      unsubAllocations.forEach((unsubscribe) => unsubscribe());
    };
  }, [navigate]);

  useEffect(() => {
    if (userProfile?.role !== "admin") {
      setRemoteAdminNotifications([]);
      return undefined;
    }

    return subscribeToAppNotifications({
      db,
      section: "crunzzo",
      role: "admin",
      uid: userProfile.uid,
      onChange: setRemoteAdminNotifications,
    });
  }, [userProfile?.role, userProfile?.uid]);

  const totalSalesValue = useMemo(
    () => orders.reduce((sum, item) => sum + Number(item.total || 0), 0),
    [orders]
  );

  const inventoryValue = useMemo(
    () => products.reduce((sum, item) => sum + getCrunzzoInventoryValue(item), 0),
    [products]
  );

  const lowStockCount = useMemo(
    () => products.filter((item) => isCrunzzoLowStock(item)).length,
    [products]
  );

  const filteredInventory = useMemo(() => {
    const q = inventorySearch.trim().toLowerCase();
    if (!q) return products;

    return products.filter((item) => {
      const text = `${item.name || ""} ${item.category || ""} ${item.skuCode || ""}`.toLowerCase();
      return text.includes(q);
    });
  }, [products, inventorySearch]);

  const filteredSales = useMemo(() => {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

    // Start of week
    const d1 = new Date(now);
    const day = d1.getDay();
    const diff = d1.getDate() - day + (day === 0 ? -6 : 1);
    const startOfWeek = new Date(d1.setDate(diff)).setHours(0, 0, 0, 0);

    // Start of month
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

    return orders.filter((order) => {
      const ts = Number(order.createdAtMs || 0);
      let timeMatch = true;
      if (historyFilter === "today") timeMatch = ts >= startOfToday;
      else if (historyFilter === "week") timeMatch = ts >= startOfWeek;
      else if (historyFilter === "month") timeMatch = ts >= startOfMonth;
      else if (historyFilter === "date" && startDate) {
        const selStart = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate()).getTime();
        const selEnd = endDate
          ? new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate()).getTime() + 86400000
          : selStart + 86400000;
        timeMatch = ts >= selStart && ts < selEnd;
      }
      else if (historyFilter === "all") timeMatch = true;

      const q = salesSearch.trim().toLowerCase();
      const searchMatch =
        !q ||
        `${order.shopName || ""} ${order.distributorName || ""} ${order.distributorId || ""}`
          .toLowerCase()
          .includes(q);

      return timeMatch && searchMatch;
    });
  }, [orders, salesSearch, historyFilter, startDate, endDate]);

  const salesTotal = useMemo(() => {
    return filteredSales.reduce((sum, item) => sum + Number(item.total || 0), 0);
  }, [filteredSales]);

  const totalUnitsSold = useMemo(() => {
    return orders.reduce(
      (sum, order) =>
        sum + (order.items || []).reduce((s, i) => s + Number(i.totalUnits || i.quantity || 0), 0),
      0
    );
  }, [orders]);

  const skuStats = useMemo(() => getSkuStats(orders), [orders]);
  const topSku = useMemo(() => skuStats[0] || EMPTY_SKU_STAT, [skuStats]);
  const topSkuProduct = useMemo(() => {
    const topName = (topSku.name || "").trim().toLowerCase();
    return products.find((item) => {
      return item.id === topSku.productId || (item.name || "").trim().toLowerCase() === topName;
    });
  }, [products, topSku]);
  const pincodeStats = useMemo(() => getPincodeStats(orders), [orders]);

  useEffect(() => {
    const pendingPincodes = pincodeStats
      .filter((item) => !item.city)
      .map((item) => String(item.name || "").trim())
      .filter((pincode) => isValidPincode(pincode) && !PINCODE_CITY_OVERRIDES[pincode] && !pincodeCityLookup[pincode]);

    if (!pendingPincodes.length) return undefined;

    let cancelled = false;
    Promise.all(
      [...new Set(pendingPincodes)].map(async (pincode) => {
        try {
          return [pincode, await fetchPincodeCity(pincode)];
        } catch {
          return [pincode, ""];
        }
      })
    ).then((results) => {
      if (cancelled) return;

      const resolved = results.filter(([, city]) => city);
      if (!resolved.length) return;

      setPincodeCityLookup((prev) => {
        const next = { ...prev };
        resolved.forEach(([pincode, city]) => {
          next[pincode] = city;
        });
        savePincodeCityCache(next);
        return next;
      });
    });

    return () => {
      cancelled = true;
    };
  }, [pincodeCityLookup, pincodeStats]);

  const productById = useMemo(
    () => Object.fromEntries(products.map((product) => [product.id, product])),
    [products]
  );

  const retailerRankings = useMemo(() => {
    const retailers = users.filter((user) => isRetailerRole(user.role));
    const rows = {};

    retailers.forEach((retailer) => {
      const region = getCrunzzoUserRegion(retailer, "Unassigned");
      rows[retailer.id] = {
        id: retailer.id,
        name: retailer.name || "Retailer",
        businessName: retailer.businessName || "",
        phone: retailer.phone || "",
        retailerId: retailer.retailerId || retailer.partnerId || "",
        region,
        orderCount: 0,
        totalValue: 0,
        totalUnits: 0,
        lastOrderMs: 0,
      };
    });

    orders.filter(isRetailerOrder).forEach((order) => {
      const key = order.retailerUid || order.partnerUid || order.retailerId || order.id;
      if (!rows[key]) {
        rows[key] = {
          id: key,
          name: order.retailerName || order.partnerName || "Retailer",
          businessName: order.shopName || "",
          phone: order.phone || "",
          retailerId: order.retailerId || order.partnerId || "",
          region: order.region || "Unassigned",
          orderCount: 0,
          totalValue: 0,
          totalUnits: 0,
          lastOrderMs: 0,
        };
      }

      rows[key].region = order.region || rows[key].region || "Unassigned";
      rows[key].orderCount += 1;
      rows[key].totalValue += Number(order.total || 0);
      rows[key].totalUnits += Number(order.totalUnits || 0);
      rows[key].lastOrderMs = Math.max(rows[key].lastOrderMs, Number(order.createdAtMs || 0));
    });

    return Object.values(rows)
      .filter((row) => retailerRegionFilter === "all" || getCrunzzoUserRegion(row, "") === retailerRegionFilter)
      .sort((a, b) => b.totalValue - a.totalValue || b.orderCount - a.orderCount || b.totalUnits - a.totalUnits);
  }, [orders, retailerRegionFilter, users]);

  const computedAdminNotifications = useMemo(() => {
    const alerts = [];

    orders.slice(0, 8).forEach((order) => {
      const partnerName =
        order.partnerName ||
        order.retailerName ||
        order.distributorName ||
        order.shopName ||
        "Partner";
      const orderItems = Array.isArray(order.items) ? order.items : [];
      const totalUnits =
        Number(order.totalUnits || 0) ||
        orderItems.reduce((sum, item) => sum + getItemUnits(item), 0);
      const itemSummary = orderItems.length
        ? orderItems
            .map((item) => {
              const quantity = Number(item.quantity || 0);
              const units = getItemUnits(item);
              return `${item.name || "Item"} x ${quantity || 1} (${units} units)`;
            })
            .join(", ")
        : "No item details saved";

      const id = `order-${order.id}`;
      const title = isRetailerOrder(order) ? "Retailer purchase recorded" : "Distributor sale recorded";
      const message = `${order.partnerName || order.retailerName || order.distributorName || order.shopName || "Partner"} • ${order.region || "No region"} • ${formatRupees(order.total || 0)}`;
      const detail = buildNotificationBody([
          `Partner: ${partnerName}`,
          `Region: ${order.region || "No region"}`,
          `Total: ${formatRupees(order.total || 0)}`,
          `Units: ${totalUnits}`,
          `Items: ${itemSummary}`,
          order.invoiceNumber ? `Invoice: ${order.invoiceNumber}` : "",
        ]);

      alerts.push({
        id,
        sourceId: id,
        tone: isRetailerOrder(order) ? "#b45309" : BRAND,
        section: "crunzzo",
        type: "recent_order",
        severity: "info",
        title,
        body: message,
        message,
        detail,
        targetRoles: ["admin"],
        entityType: "order",
        entityId: order.id,
        targetPath: "/crunzzo/admin/notifications",
        targetTab: "notifications",
        data: { detail, sourceId: id },
        dedupeKey: `crunzzo:admin:recent_order:${order.id}`,
        pushEnabled: true,
        time: formatTime(order.createdAtMs),
        createdAtMs: Number(order.createdAtMs || 0),
      });
    });

    products.filter((product) => isCrunzzoLowStock(product)).slice(0, 8).forEach((product) => {
      const totalUnits = getCrunzzoTotalUnits(product);
      const id = `low-${product.id}`;
      const message = `${product.name || "Product"} has ${getCrunzzoTotalUnits(product)} units left in admin stock.`;
      const detail = [
        `Product: ${product.name || "Product"}`,
        `SKU: ${product.skuCode || "-"}`,
        `Category: ${product.category || "-"}`,
        `Central stock: ${totalUnits} units`,
        `Low stock level: ${Number(product.lowStockThreshold || 0)} units`,
      ].join("\n");

      alerts.push({
        id,
        sourceId: id,
        tone: BRAND,
        section: "crunzzo",
        type: "low_central_stock",
        severity: "danger",
        title: "Low central stock",
        body: message,
        message,
        detail,
        targetRoles: ["admin"],
        entityType: "product",
        entityId: product.id,
        targetPath: "/crunzzo/admin/notifications",
        targetTab: "notifications",
        data: { detail, sourceId: id },
        dedupeKey: `crunzzo:admin:low_central_stock:${product.id}`,
        pushEnabled: true,
        time: "Inventory",
        createdAtMs: Number(product.updatedAtMs || product.createdAtMs || 0),
      });
    });

    CRUNZZO_REGIONS.forEach((region) => {
      Object.values(regionalAllocations[region.id] || {}).forEach((allocation) => {
        const product = productById[allocation.productId || allocation.id] || {};
        const remaining = getRegionalRemainingUnits(allocation);
        const minPack = getSmallestPackSize(product);
        if (remaining > 0 && remaining < minPack) {
          const id = `pack-${region.id}-${allocation.productId || allocation.id}`;
          const message = `${product.name || allocation.productName || "Product"} has ${remaining} units in ${region.name}, below the ${minPack}-unit pack.`;
          const detail = [
            `Product: ${product.name || allocation.productName || "Product"}`,
            `SKU: ${product.skuCode || allocation.skuCode || "-"}`,
            `Region: ${region.name}`,
            `Remaining regional stock: ${remaining} units`,
            `Smallest pack size: ${minPack} units`,
            "Action: Allocate more units or wait until enough stock is available for a full pack.",
          ].join("\n");

          alerts.push({
            id,
            sourceId: id,
            tone: "#b45309",
            section: "crunzzo",
            type: "no_full_pack_available",
            severity: "warning",
            title: "No full pack available",
            body: message,
            message,
            detail,
            targetRoles: ["admin"],
            entityType: "regional_inventory",
            entityId: allocation.productId || allocation.id,
            targetPath: "/crunzzo/admin/notifications",
            targetTab: "notifications",
            data: { detail, sourceId: id, regionId: region.id },
            dedupeKey: `crunzzo:admin:no_full_pack_available:${region.id}:${allocation.productId || allocation.id}`,
            pushEnabled: true,
            time: region.name,
            createdAtMs: Number(allocation.updatedAtMs || 0),
          });
        }
      });
    });

    return alerts.sort((a, b) => b.createdAtMs - a.createdAtMs).slice(0, 20);
  }, [orders, productById, products, regionalAllocations]);

  useEffect(() => {
    if (userProfile?.role !== "admin") return;
    syncComputedAppNotifications(db, computedAdminNotifications);
  }, [computedAdminNotifications, userProfile?.role]);

  const adminNotifications = useMemo(
    () => mergeAppNotifications(remoteAdminNotifications, computedAdminNotifications).slice(0, 20),
    [computedAdminNotifications, remoteAdminNotifications]
  );

  const maxRetailerValue = retailerRankings[0]?.totalValue || 1;
  const unreadAdminNotificationCount = adminNotifications.filter(
    (item) => !isAppNotificationViewed(item, userProfile?.uid, viewedNotifications)
  ).length;
  const prioritizedAdminNotifications = useMemo(() => {
    const unread = [];
    const viewed = [];
    adminNotifications.forEach((item) => {
      if (isAppNotificationViewed(item, userProfile?.uid, viewedNotifications)) viewed.push(item);
      else unread.push(item);
    });
    return [...unread, ...viewed];
  }, [adminNotifications, userProfile?.uid, viewedNotifications]);

  const openAdminNotification = (item) => {
    setSelectedNotification(item);
    markAppNotificationViewed(db, item, userProfile?.uid).catch((error) => {
      console.warn("Failed to mark admin notification read:", error);
    });
    setViewedNotifications((previous) => {
      if (previous[item.id] || previous[item.sourceId]) return previous;
      const viewedAt = Date.now();
      const next = {
        ...previous,
        [item.id]: viewedAt,
        ...(item.sourceId ? { [item.sourceId]: viewedAt } : {}),
        ...(item.dedupeKey ? { [item.dedupeKey]: viewedAt } : {}),
      };
      saveStoredIdMap(ADMIN_VIEWED_NOTIFICATIONS_KEY, next);
      return next;
    });
  };

  const categoryOptions = useMemo(() => {
    const productCategories = products.map((item) => item.category || "");
    return [...new Set([...CATEGORY_OPTIONS, ...customCategoryOptions, ...productCategories, productForm.category])]
      .map((item) => String(item).trim())
      .filter(Boolean);
  }, [customCategoryOptions, productForm.category, products]);

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setShowLogoutConfirm(false);
      routeToChooseSelection(navigate);
    } catch (error) {
      console.error("Logout failed:", error);
    }
  };

  const getAllocationForRegion = (regionId, productId) =>
    regionalAllocations[regionId]?.[productId] || null;

  useEffect(() => {
    const allRegionsLoaded = CRUNZZO_REGIONS.every(
      (region) => loadedAllocationRegions[region.id]
    );
    if (userProfile?.role !== "admin" || !allRegionsLoaded || !products.length) return;

    const projections = products.map((product) => ({
      product,
      regionalStock: Object.fromEntries(
        CRUNZZO_REGIONS.map((region) => [
          region.id,
          getRegionalRemainingUnits(getAllocationForRegion(region.id, product.id)),
        ])
      ),
    }));
    const syncKey = JSON.stringify(
      projections.map(({ product, regionalStock }) => [product.id, regionalStock])
    );
    if (regionalProjectionSyncKeyRef.current === syncKey) return;
    regionalProjectionSyncKeyRef.current = syncKey;

    const pendingUpdates = projections.filter(({ product, regionalStock }) =>
      CRUNZZO_REGIONS.some(
        (region) => Number(product.regionalStock?.[region.id] || 0) !== regionalStock[region.id]
      )
    );
    if (!pendingUpdates.length) return;

    Promise.all(
      pendingUpdates.map(({ product, regionalStock }) =>
        updateDoc(doc(db, "products", product.id), {
          regionalStock,
          regionalStockUpdatedAtMs: Date.now(),
        })
      )
    ).catch((error) => {
      regionalProjectionSyncKeyRef.current = "";
      console.error("Regional stock projection sync failed:", error);
    });
  }, [loadedAllocationRegions, products, regionalAllocations, userProfile]);

  const getAllocationDraftValue = (regionId, productId) => {
    const key = `${productId}_${regionId}`;
    if (Object.prototype.hasOwnProperty.call(allocationDrafts, key)) {
      return allocationDrafts[key];
    }
    return String(getAllocationForRegion(regionId, productId)?.allocatedUnits || 0);
  };

  const filteredAllocationProducts = useMemo(() => {
    let filtered = products;
    if (allocationCategoryFilter !== "All") {
      filtered = filtered.filter((p) => p.category === allocationCategoryFilter);
    }
    if (allocationSearch.trim()) {
      const term = allocationSearch.toLowerCase();
      filtered = filtered.filter(
        (p) =>
          (p.name || "").toLowerCase().includes(term) ||
          (p.skuCode || "").toLowerCase().includes(term)
      );
    }
    return filtered;
  }, [products, allocationSearch, allocationCategoryFilter]);

  const handleAllocationDraft = (productId, regionId, value) => {
    setAllocationMessage("");
    setAllocationErrorModal(null);
    setAllocationDrafts((previous) => ({
      ...previous,
      [`${productId}_${regionId}`]: sanitizeNumber(value),
    }));
  };

  const saveRegionalAllocation = async (product) => {
    const proposedAllocations = CRUNZZO_REGIONS.map((region) => {
      const current = getAllocationForRegion(region.id, product.id) || {};
      return {
        region,
        allocatedUnits: Number(getAllocationDraftValue(region.id, product.id) || 0),
        fulfilledUnits: Number(current.fulfilledUnits || 0),
      };
    });
    const invalidAllocation = proposedAllocations.find(
      (item) => !Number.isInteger(item.allocatedUnits) || item.allocatedUnits < 0
    );
    const belowFulfilled = proposedAllocations.find(
      (item) => item.allocatedUnits < item.fulfilledUnits
    );

    if (invalidAllocation || belowFulfilled) {
      const message = invalidAllocation
        ? `${invalidAllocation.region.name} allocation must be a whole number.`
        : `${belowFulfilled.region.name} allocation cannot be lower than ${belowFulfilled.fulfilledUnits} fulfilled units.`;
      setAllocationErrorModal({
        title: "Unable to Save Allocation",
        message,
        productName: product.name || "Selected product",
      });
      return;
    }

    const proposedRemainingTotal = proposedAllocations.reduce(
      (sum, item) => sum + Math.max(0, item.allocatedUnits - item.fulfilledUnits),
      0
    );
    const visibleCentralStock = Number(product.stock || 0);

    if (proposedRemainingTotal > visibleCentralStock) {
      setAllocationErrorModal({
        title: "Allocation Exceeds Available Stock",
        message: `Regional remaining allocations (${proposedRemainingTotal}) exceed central stock (${visibleCentralStock}).`,
        productName: product.name || "Selected product",
        totalRemainingAllocation: proposedRemainingTotal,
        centralStock: visibleCentralStock,
        excessUnits: proposedRemainingTotal - visibleCentralStock,
      });
      return;
    }

    try {
      setSavingAllocationId(product.id);
      setAllocationMessage("");
      setAllocationErrorModal(null);

      await runTransaction(db, async (transaction) => {
        const productRef = doc(db, "products", product.id);
        const allocationRefs = CRUNZZO_REGIONS.map((region) => ({
          region,
          ref: doc(
            db,
            "regional_inventory",
            region.id,
            "products",
            getAllocationForRegion(region.id, product.id)?.id || product.id
          ),
        }));

        const productSnapshot = await transaction.get(productRef);
        const allocationSnapshots = [];
        for (const entry of allocationRefs) {
          allocationSnapshots.push(await transaction.get(entry.ref));
        }

        if (!productSnapshot.exists()) {
          throw new Error("Product no longer exists.");
        }

        const centralStock = Number(productSnapshot.data().stock || 0);
        const nextAllocations = allocationRefs.map((entry, index) => {
          const current = allocationSnapshots[index].exists()
            ? allocationSnapshots[index].data()
            : {};
          const allocatedUnits = Number(getAllocationDraftValue(entry.region.id, product.id) || 0);
          const fulfilledUnits = Number(current.fulfilledUnits || 0);

          if (!Number.isInteger(allocatedUnits) || allocatedUnits < 0) {
            throw new Error(`${entry.region.name} allocation must be a whole number.`);
          }
          if (allocatedUnits < fulfilledUnits) {
            throw new Error(
              `${entry.region.name} allocation cannot be lower than ${fulfilledUnits} fulfilled units.`
            );
          }

          return { ...entry, allocatedUnits, fulfilledUnits };
        });

        const totalRemainingAllocation = nextAllocations.reduce(
          (sum, item) => sum + Math.max(0, item.allocatedUnits - item.fulfilledUnits),
          0
        );

        if (totalRemainingAllocation > centralStock) {
          const allocationError = new Error(
            `Regional remaining allocations (${totalRemainingAllocation}) exceed central stock (${centralStock}).`
          );
          allocationError.code = "regional-allocation-exceeds-stock";
          allocationError.details = {
            totalRemainingAllocation,
            centralStock,
            excessUnits: totalRemainingAllocation - centralStock,
          };
          throw allocationError;
        }

        transaction.update(productRef, {
          regionalStock: Object.fromEntries(
            nextAllocations.map((item) => [
              item.region.id,
              Math.max(0, item.allocatedUnits - item.fulfilledUnits),
            ])
          ),
          regionalStockUpdatedAtMs: Date.now(),
        });

        nextAllocations.forEach((item) => {
          transaction.set(
            item.ref,
            {
              productId: product.id,
              productName: product.name || "",
              skuCode: product.skuCode || "",
              region: item.region.name,
              allocatedUnits: item.allocatedUnits,
              fulfilledUnits: item.fulfilledUnits,
              updatedAt: serverTimestamp(),
              updatedAtMs: Date.now(),
            },
            { merge: true }
          );
        });
      });

      setAllocationDrafts((previous) => {
        const next = { ...previous };
        CRUNZZO_REGIONS.forEach((region) => delete next[`${product.id}_${region.id}`]);
        return next;
      });
      setAllocationMessage(`${product.name} regional allocation saved.`);
    } catch (error) {
      console.error("Regional allocation save failed:", error);
      const stockMismatch = String(error.message || "").match(
        /Regional remaining allocations \((\d+)\) exceed central stock \((\d+)\)/
      );
      const parsedDetails = stockMismatch
        ? {
            totalRemainingAllocation: Number(stockMismatch[1]),
            centralStock: Number(stockMismatch[2]),
            excessUnits: Number(stockMismatch[1]) - Number(stockMismatch[2]),
          }
        : {};
      setAllocationErrorModal({
        title: error.code === "regional-allocation-exceeds-stock" || stockMismatch
          ? "Allocation Exceeds Available Stock"
          : "Unable to Save Allocation",
        message: error.message || "Failed to save regional allocation.",
        productName: product.name || "Selected product",
        ...parsedDetails,
        ...(error.details || {}),
      });
    } finally {
      setSavingAllocationId("");
    }
  };

  const handleProductInput = (e) => {
    const { name, value } = e.target;
    let finalValue = value;

    const lowerName = name.toLowerCase();
    if (
      lowerName.includes("rate") ||
      lowerName.includes("stock") ||
      lowerName.includes("gst") ||
      lowerName.includes("size") ||
      lowerName.includes("lowstockthreshold") ||
      lowerName.includes("offer")
    ) {
      finalValue = sanitizeNumber(value);
    }

    setProductMessage("");
    setProductForm((prev) => ({
      ...prev,
      [name]: finalValue,
    }));
  };

  const addCustomCategory = (rawValue) => {
    const cleaned = rawValue.trim().replace(/\s+/g, " ");
    if (!cleaned) return;

    setProductMessage("");
    setCustomCategoryOptions((prev) => {
      const exists = prev.some((item) => item.toLowerCase() === cleaned.toLowerCase());
      return exists ? prev : [...prev, cleaned];
    });
    setProductForm((prev) => ({
      ...prev,
      category: cleaned,
    }));
  };

  const openCategoryModal = () => {
    setNewCategoryName("");
    setNewCategoryError("");
    setCategoryModalOpen(true);
  };

  const closeCategoryModal = () => {
    setCategoryModalOpen(false);
    setNewCategoryName("");
    setNewCategoryError("");
  };

  const submitNewCategory = (event) => {
    event.preventDefault();

    const cleaned = newCategoryName.trim().replace(/\s+/g, " ");
    if (!cleaned) {
      setNewCategoryError("Please enter a category name.");
      return;
    }

    const existing = categoryOptions.find((item) => item.toLowerCase() === cleaned.toLowerCase());
    if (existing) {
      setProductForm((prev) => ({
        ...prev,
        category: existing,
      }));
      closeCategoryModal();
      return;
    }

    addCustomCategory(cleaned);
    closeCategoryModal();
  };

  const handleProductCategoryChange = (event) => {
    const { value } = event.target;

    if (value === ADD_CATEGORY_VALUE) {
      openCategoryModal();
      return;
    }

    setProductMessage("");
    setProductForm((prev) => ({
      ...prev,
      category: value,
    }));
  };

  const addZoneFromValue = (rawValue) => {
    const cleaned = rawValue.trim();
    if (!cleaned) return;

    setProductForm((prev) => {
      const exists = prev.zones.some((zone) => zone.toLowerCase() === cleaned.toLowerCase());
      if (exists) return prev;
      return {
        ...prev,
        zones: [...prev.zones, cleaned],
      };
    });
  };

  const handleAddZone = () => {
    addZoneFromValue(zoneInput);
    setZoneInput("");
  };

  const removeZone = (zoneToRemove) => {
    setProductForm((prev) => ({
      ...prev,
      zones: prev.zones.filter((zone) => zone !== zoneToRemove),
    }));
  };

  const handleImagePick = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
    setProductMessage("");
  };

  const resetProductForm = () => {
    setProductForm({
      name: "",
      pricingGroup: "Standard Retail",
      description: "",
      skuCode: "",
      category: "Chips",
      zones: [],
      stock: "0",
      gst: "18",
      lowStockThreshold: "20",
      retailerOfferPercent: "0",
      pack12Size: "12",
      pack12PricingGroup: "Standard Retail",
      pack12Rate: "",
      pack240Size: "240",
      pack240PricingGroup: "Standard Retail",
      pack240Rate: "",
    });
    setImageFile(null);
    setImagePreview("");
    setZoneInput("");
  };

  const handleSaveProduct = async () => {
    if (!productForm.name.trim()) {
      setProductMessage("Please enter product name.");
      return;
    }

    const packOptions = buildCrunzzoPackOptionsFromForm(productForm);
    const invalidPack = packOptions.find((pack) => Number(pack.rate || 0) <= 0);
    if (invalidPack) {
      setProductMessage(`Please enter price for ${invalidPack.label}.`);
      return;
    }

    if (!imageFile) {
      setProductMessage("Please upload a product image.");
      return;
    }

    try {
      setSavingProduct(true);
      setProductMessage("");

      const ext = imageFile.name.split(".").pop() || "jpg";
      const storageRef = ref(
        storage,
        `products/${Date.now()}-${productForm.name.replace(/\s+/g, "-").toLowerCase()}.${ext}`
      );

      await uploadBytes(storageRef, imageFile);
      const imageUrl = await getDownloadURL(storageRef);

      const totalStockUnits = getCrunzzoTotalUnits(packOptions);
      const primaryPack = packOptions[0];
      const retailerOfferPercent = Math.min(100, Number(productForm.retailerOfferPercent || 0));

      await addDoc(collection(db, "products"), {
        name: productForm.name.trim(),
        rate: primaryPack.rate,
        price: primaryPack.rate,
        pricingGroup: primaryPack.pricingGroup,
        gst: primaryPack.gst,
        description: productForm.description.trim(),
        skuCode: productForm.skuCode.trim(),
        unitLabel: "Packs",
        stock: totalStockUnits,
        openingStock: totalStockUnits,
        lowStockThreshold: Number(productForm.lowStockThreshold || 0),
        retailerOfferPercent,
        category: productForm.category,
        zones: productForm.zones,
        packSellingMode: "fixed-packs",
        packOptions,
        imageUrl,
        status: "active",
        createdAt: serverTimestamp(),
        createdAtMs: Date.now(),
      });

      setProductMessage("Product saved successfully.");
      resetProductForm();
      goToTab("inventory");
    } catch (error) {
      console.error("Save product failed:", error);
      setProductMessage("Failed to save product.");
    } finally {
      setSavingProduct(false);
    }
  };

  const toggleProductStatus = async (product) => {
    try {
      await updateDoc(doc(db, "products", product.id), {
        status: product.status === "inactive" ? "active" : "inactive",
      });
    } catch (error) {
      console.error("Status update failed:", error);
    }
  };

  const startProductEdit = (product) => {
    const totalUnits = getCrunzzoTotalUnits(product);
    const packOptions = normalizeCrunzzoPackOptions(product);
    const firstPack = packOptions[0] || {};
    const packForm = packOptions.reduce((acc, pack) => {
      acc[`${pack.id}Size`] = String(pack.packSize || "");
      acc[`${pack.id}Rate`] = pack.rate ? String(pack.rate) : "";
      acc[`${pack.id}PricingGroup`] = pack.pricingGroup || product.pricingGroup || "Standard Retail";
      return acc;
    }, {});

    setEditingProductId(product.id);
    setEditingProductForm({
      name: product.name || "",
      category: product.category || "Chips",
      skuCode: product.skuCode || "",
      stock: totalUnits ? String(totalUnits) : "",
      gst: firstPack.gst ? String(firstPack.gst) : "",
      lowStockThreshold: product.lowStockThreshold ? String(product.lowStockThreshold) : "",
      retailerOfferPercent: String(product.retailerOfferPercent ?? product.offerPercent ?? 0),
      ...packForm,
    });
  };

  const cancelProductEdit = () => {
    setEditingProductId(null);
    setEditingProductForm({});
  };

  const handleProductEditInput = (event) => {
    const { name, value } = event.target;
    const lowerName = name.toLowerCase();
    const isNumericPackField =
      lowerName.includes("rate") ||
      lowerName.includes("stock") ||
      lowerName.includes("gst") ||
      lowerName.includes("size") ||
      lowerName.includes("lowstockthreshold") ||
      lowerName.includes("offer");

    setEditingProductForm((prev) => ({
      ...prev,
      [name]: isNumericPackField ? sanitizeNumber(value) : value,
    }));
  };

  const handleSaveProductEdit = async (product) => {
    const nextName = (editingProductForm.name || "").trim();
    const packOptions = buildCrunzzoPackOptionsFromForm(editingProductForm);
    const invalidPack = packOptions.find((pack) => Number(pack.rate || 0) <= 0);

    if (!nextName) {
      alert("Please enter product name.");
      return;
    }

    if (invalidPack) {
      alert(`Please enter price for ${invalidPack.label}.`);
      return;
    }

    try {
      setSavingProductEdit(true);
      const totalStockUnits = toNumber(editingProductForm.stock, 0);
      const primaryPack = packOptions[0];
      const retailerOfferPercent = Math.min(100, Number(editingProductForm.retailerOfferPercent || 0));

      const updatePayload = {
        name: nextName,
        category: editingProductForm.category || "Chips",
        skuCode: editingProductForm.skuCode || "",
        rate: primaryPack.rate,
        price: primaryPack.rate,
        pricingGroup: primaryPack.pricingGroup,
        gst: primaryPack.gst,
        unitLabel: "Packs",
        stock: totalStockUnits,
        lowStockThreshold: Number(editingProductForm.lowStockThreshold || 0),
        retailerOfferPercent,
        packSellingMode: "fixed-packs",
        packOptions,
        updatedAtMs: Date.now(),
      };

      await updateDoc(doc(db, "products", product.id), updatePayload);
      cancelProductEdit();
    } catch (error) {
      console.error("Product update failed. Payload:", error);
      alert(`Update Failed: ${error.code || "Error"}. ${error.message}`);
    } finally {
      setSavingProductEdit(false);
    }
  };

  const handleDeleteProduct = async (product) => {
    if (!window.confirm(`Are you sure you want to delete ${product.name}?`)) return;
    try {
      await deleteDoc(doc(db, "products", product.id));
    } catch (error) {
      console.error("Delete product failed:", error);
      alert("Failed to delete product.");
    }
  };

  const pageBackground = activeTab === "products" ? "#ffffff" : BG;
  const shellBackground = activeTab === "products" ? "#ffffff" : BG;
  const contentBackground = activeTab === "products" ? "#ffffff" : "transparent";

  if (loading) {
    return (
      <div
        style={{
          minHeight: "100vh",
          background: pageBackground,
          display: "grid",
          placeItems: "center",
          color: MUTED,
        }}
      >
        Loading admin dashboard...
      </div>
    );
  }

  if (!userProfile) {
    return (
      <div
        style={{
          minHeight: "100vh",
          background: pageBackground,
          display: "grid",
          placeItems: "center",
          color: MUTED,
        }}
      >
        Please log in again.
      </div>
    );
  }

  if (userProfile.role !== "admin") {
    return (
      <div
        style={{
          minHeight: "100vh",
          background: pageBackground,
          display: "grid",
          placeItems: "center",
          color: MUTED,
        }}
      >
        This page is only for admin users.
      </div>
    );
  }

  return (
    <div
      className="admin-page-wrapper"
      style={{
        minHeight: "100vh",
        background: pageBackground,
        display: "flex",
        justifyContent: "center",
        padding: 14,
      }}
    >
      <style>{`
        @media (max-width: 480px) {
          .admin-page-wrapper {
            padding: 0 !important;
            height: 100dvh !important;
            min-height: 100dvh !important;
          }
          .admin-shell-wrapper {
            max-width: none !important;
            height: 100dvh !important;
            min-height: 100dvh !important;
            border: none !important;
            box-shadow: none !important;
          }
          .admin-content-area {
            padding-bottom: 20px !important;
          }
          .admin-footer-bar {
            padding-bottom: calc(8px + env(safe-area-inset-bottom)) !important;
          }
        }
      `}</style>
      <div
        className="admin-shell-wrapper"
        style={{
          width: "100%",
          maxWidth: 430,
          minHeight: "calc(100vh - 28px)",
          background: shellBackground,
          border: activeTab === "products" ? "1px solid #efefef" : "1px solid #e7e7e7",
          boxShadow:
            activeTab === "products"
              ? "0 4px 18px rgba(0,0,0,0.03)"
              : "0 12px 30px rgba(0,0,0,0.04)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <div
          className="admin-content-area"
          style={{
            flex: 1,
            overflowY: "auto",
            overflowX: "hidden",
            padding: 14,
            background: contentBackground,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 16,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", minWidth: 0 }}>
              <img
                src={crunzzoLogo}
                alt="Crunzzo"
                style={{ height: 44, maxWidth: 142, objectFit: "contain", objectPosition: "left center" }}
              />
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <button
                type="button"
                onClick={() => goToTab("notifications")}
                style={{
                  border: `1px solid ${activeTab === "notifications" ? BRAND : BORDER}`,
                  background: activeTab === "notifications" ? "#fff0f0" : "#fff",
                  color: activeTab === "notifications" ? BRAND : TEXT,
                  height: 34,
                  padding: "0 10px",
                  borderRadius: 10,
                  fontWeight: 800,
                  cursor: "pointer",
                }}
              >
                Alerts {unreadAdminNotificationCount ? `(${unreadAdminNotificationCount})` : ""}
              </button>
              <button
                type="button"
                onClick={() => setShowLogoutConfirm(true)}
                style={{
                  border: "none",
                  background: "#fff",
                  color: BRAND,
                  height: 34,
                  padding: "0 12px",
                  borderRadius: 10,
                  fontWeight: 700,
                  cursor: "pointer",
                  borderWidth: 1,
                  borderStyle: "solid",
                  borderColor: BORDER,
                }}
              >
                Logout
              </button>
              <button
                type="button"
                onClick={() => goToTab("profile")}
                aria-label="Edit admin profile"
                style={{
                  width: 48,
                  height: 48,
                  border: `2px solid ${activeTab === "profile" ? BRAND : "transparent"}`,
                  borderRadius: "50%",
                  background: "#f2f4f7",
                  display: "grid",
                  placeItems: "center",
                  fontSize: 16,
                  color: TEXT,
                  fontWeight: 900,
                  cursor: "pointer",
                  padding: 0,
                  overflow: "hidden",
                }}
              >
                {userProfile.profileImageUrl ? (
                  <img
                    src={userProfile.profileImageUrl}
                    alt={userProfile.name || "Admin profile"}
                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                  />
                ) : (
                  (userProfile.name || "A").charAt(0).toUpperCase()
                )}
              </button>
            </div>
          </div>

          {activeTab === "profile" && (
            <AdminProfileEditor
              userProfile={userProfile}
              setUserProfile={setUserProfile}
              db={db}
              storage={storage}
              brand={BRAND}
              text={TEXT}
              muted={MUTED}
              border={BORDER}
              card={CARD}
              logo={crunzzoLogo}
              logoAlt="Crunzzo"
              onBack={() => goToTab("dashboard")}
              onNavigate={goToTab}
              onLogout={handleLogout}
              stats={{
                totalSales: formatCompact(totalSalesValue),
                orderCount: orders.length,
                inventoryValue: formatCompact(inventoryValue),
                lowStockCount,
              }}
            />
          )}

          {activeTab === "dashboard" && (
            <>
              <div style={{ marginBottom: 16 }}>
                <h1 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: TEXT }}>
                  Welcome back, {userProfile.name || "Admin"}
                </h1>
                <p style={{ margin: "4px 0 0", fontSize: 12, color: MUTED }}>
                  Here&apos;s your snack business status today.
                </p>
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 12,
                  marginBottom: 16,
                }}
              >
                <StatCard
                  title="Total Sales"
                  value={formatCompact(totalSalesValue)}
                  subtitle={`${orders.length} closed sales`}
                />
                <StatCard
                  title="Stock Available"
                  value={products.reduce((s, p) => s + getCrunzzoTotalUnits(p), 0)}
                  subtitle="Current stock count"
                />
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 10,
                  marginBottom: 16,
                }}
              >
                <button
                  type="button"
                  onClick={() => goToTab("retailers")}
                  style={{
                    minHeight: 48,
                    borderRadius: 14,
                    border: `1px solid ${BORDER}`,
                    background: "#fff",
                    color: TEXT,
                    fontWeight: 900,
                    cursor: "pointer",
                  }}
                >
                  Top Retailers
                </button>
                <button
                  type="button"
                  onClick={() => goToTab("notifications")}
                  style={{
                    minHeight: 48,
                    borderRadius: 14,
                    border: `1px solid ${BORDER}`,
                    background: "#fff",
                    color: TEXT,
                    fontWeight: 900,
                    cursor: "pointer",
                  }}
                >
                  Notifications
                </button>
              </div>

              <SectionCard>
                <div style={{ fontSize: 13, fontWeight: 800, color: TEXT, marginBottom: 10 }}>
                  Key Insight
                </div>

                <div
                  style={{
                    background: "#f8f8f8",
                    borderRadius: 16,
                    overflow: "hidden",
                    border: `1px solid ${BORDER}`,
                  }}
                >
                  <div
                    style={{
                      height: 140,
                      background: "#f3f3f3",
                      display: "grid",
                      placeItems: "center",
                    }}
                  >
                    {(topSkuProduct?.imageUrl || topSku.imageUrl) ? (
                      <img
                        src={topSkuProduct?.imageUrl || topSku.imageUrl}
                        alt={topSku.name}
                        style={{ maxHeight: 120, objectFit: "contain" }}
                      />
                    ) : (
                      <img
                        src={crunzzoLogo}
                        alt="Crunzzo"
                        style={{ maxHeight: 64, objectFit: "contain" }}
                      />
                    )}
                  </div>

                  <div style={{ padding: 12 }}>
                    <div style={{ fontSize: 10, color: MUTED, fontWeight: 700 }}>TOP PERFORMER</div>
                    <div style={{ marginTop: 6, fontSize: 15, fontWeight: 800, color: TEXT }}>
                      {topSku.name}
                    </div>
                    <div style={{ marginTop: 4, fontSize: 12, color: MUTED }}>
                      Total sold: {topSku.units} units
                    </div>
                    <div
                      style={{
                        marginTop: 10,
                        height: 6,
                        borderRadius: 999,
                        background: "#f5d2d4",
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          width: `${Math.min(
                            100,
                            Math.max(8, totalUnitsSold ? (topSku.units / totalUnitsSold) * 100 : 0)
                          )}%`,
                          height: "100%",
                          background: BRAND,
                        }}
                      />
                    </div>
                  </div>
                </div>
              </SectionCard>

              <div style={{ height: 14 }} />

              <SectionCard>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 12,
                  }}
                >
                  <div>
                    <div style={{ fontSize: 16, fontWeight: 800, color: TEXT }}>Sales by Pincode</div>
                    <div style={{ fontSize: 12, color: MUTED }}>Monthly pincode distribution</div>
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: BRAND }}>Maps ⌃</div>
                </div>

                <div style={{ display: "grid", gap: 12 }}>
                  {(pincodeStats.length ? pincodeStats : [{ name: "No pincode sales yet", value: 0, percent: 10 }]).map((item) => (
                    <div key={item.name}>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          fontSize: 12,
                          fontWeight: 700,
                          color: TEXT,
                        }}
                      >
                        <span style={{ textTransform: "uppercase" }}>
                          {formatPincodeLabel(item.name, pincodeCityLookup, item.city)}
                        </span>
                        <span>{formatCompact(item.value)}</span>
                      </div>
                      <div
                        style={{
                          marginTop: 6,
                          height: 6,
                          borderRadius: 999,
                          background: "#f5d2d4",
                          overflow: "hidden",
                        }}
                      >
                        <div
                          style={{
                            width: `${item.percent}%`,
                            height: "100%",
                            background: BRAND,
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </SectionCard>

              <div style={{ height: 14 }} />

              <SectionCard>
                <div style={{ fontSize: 16, fontWeight: 800, color: TEXT, marginBottom: 12 }}>
                  Other Top Performing SKUs
                </div>

                <div style={{ display: "grid", gap: 10 }}>
                  {skuStats.length ? (
                    skuStats.slice(0, 3).map((item, index) => (
                      <div
                        key={item.productId || item.name}
                        style={{
                          display: "grid",
                          gridTemplateColumns: "38px 1fr auto",
                          gap: 12,
                          alignItems: "center",
                          border: `1px solid ${BORDER}`,
                          borderRadius: 14,
                          padding: 10,
                        }}
                      >
                        <div
                          style={{
                            width: 38,
                            height: 38,
                            borderRadius: 12,
                            background: "#f7f8fb",
                            display: "grid",
                            placeItems: "center",
                            color: BRAND,
                            fontWeight: 800,
                          }}
                        >
                          #{index + 1}
                        </div>

                        <div>
                          <div style={{ fontSize: 13, fontWeight: 700, color: TEXT }}>{item.name}</div>
                          <div style={{ fontSize: 11, color: MUTED }}>
                            Category: {item.category || "Snacks"}
                          </div>
                        </div>

                        <div style={{ textAlign: "right" }}>
                          <div style={{ fontSize: 13, fontWeight: 800, color: TEXT }}>
                            {item.units} Units
                          </div>
                          <div style={{ fontSize: 11, color: BRAND }}>
                            {formatCompact(item.salesValue)} Total
                          </div>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div
                      style={{
                        border: `1px solid ${BORDER}`,
                        borderRadius: 14,
                        padding: 14,
                        color: MUTED,
                        fontSize: 13,
                        textAlign: "center",
                      }}
                    >
                      No SKU sales yet.
                    </div>
                  )}
                </div>
              </SectionCard>
            </>
          )}

          {activeTab === "sales" && (
            <>
              <div style={{ marginBottom: 16 }}>
                <h1 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: TEXT }}>Sales</h1>
                <p style={{ margin: "4px 0 0", fontSize: 12, color: MUTED }}>
                  View every recorded distributor sale.
                </p>
              </div>

              <SectionCard>
                <div style={{ padding: "4px 0" }}>
                  <div style={{ fontSize: 11, color: MUTED, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    {getFilterLabel(historyFilter, startDate, endDate)}
                  </div>
                  <div style={{ marginTop: 8, fontSize: 28, fontWeight: 900, color: BRAND }}>
                    {formatRupees(salesTotal)}
                  </div>
                  <div style={{ marginTop: 6, fontSize: 12, color: TEXT, fontWeight: 700 }}>
                    {filteredSales.length} {filteredSales.length === 1 ? "Transaction" : "Transactions"}
                  </div>
                </div>
              </SectionCard>

              <div style={{ height: 12 }} />

              <div style={{ margin: "0 -16px" }}>
                <HistoryDateFilter
                  historyFilter={historyFilter}
                  setHistoryFilter={setHistoryFilter}
                  startDate={startDate}
                  setStartDate={setStartDate}
                  endDate={endDate}
                  setEndDate={setEndDate}
                  accentColor={BRAND}
                />
              </div>

              <div style={{ height: 12 }} />

              <SectionCard>
                <input
                  value={salesSearch}
                  onChange={(e) => setSalesSearch(e.target.value)}
                  placeholder="Search by shop, distributor, ID..."
                  style={{
                    width: "100%",
                    height: 42,
                    borderRadius: 12,
                    border: `1px solid ${BORDER}`,
                    padding: "0 14px",
                    outline: "none",
                    fontSize: 13,
                  }}
                />
              </SectionCard>

              <div style={{ height: 14 }} />

              <div style={{ fontSize: 11, fontWeight: 800, color: MUTED, letterSpacing: "0.05em", marginBottom: 10, paddingLeft: 4 }}>
                {getFilterHeading(historyFilter, startDate, endDate)}
              </div>

              <div style={{ height: 14 }} />

              <div style={{ display: "grid", gap: 12 }}>
                {filteredSales.length ? (
                  filteredSales.map((order) => (
                    <SectionCard key={order.id}>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          gap: 12,
                          alignItems: "flex-start",
                        }}
                      >
                        <div>
                          <div style={{ fontSize: 15, fontWeight: 800, color: TEXT }}>
                            {order.shopName || "Unnamed Shop"}
                          </div>
                          <div style={{ fontSize: 12, color: MUTED, marginTop: 4 }}>
                            {order.distributorName || "Distributor"} • {order.salesPincode || order.pincode || "No pincode"}
                          </div>
                          <div style={{ fontSize: 11, color: MUTED, marginTop: 4 }}>
                            {formatTime(order.createdAtMs)}
                          </div>
                        </div>

                        <div style={{ textAlign: "right" }}>
                          <div style={{ fontSize: 17, fontWeight: 800, color: BRAND }}>
                            {formatRupees(order.total)}
                          </div>
                          <div style={{ fontSize: 12, color: "#27944e", marginTop: 4 }}>
                            Completed
                          </div>
                        </div>
                      </div>
                    </SectionCard>
                  ))
                ) : (
                  <SectionCard>
                    <div style={{ textAlign: "center", color: MUTED, fontSize: 13 }}>
                      No sales found.
                    </div>
                  </SectionCard>
                )}
              </div>
            </>
          )}

          {activeTab === "retailers" && (
            <>
              <div style={{ marginBottom: 16 }}>
                <h1 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: TEXT }}>
                  Top Retailers
                </h1>
                <p style={{ margin: "4px 0 0", fontSize: 12, color: MUTED }}>
                  Rank retailer purchases by region or across all regions.
                </p>
              </div>

              <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 10, marginBottom: 6 }}>
                <button
                  type="button"
                  onClick={() => setRetailerRegionFilter("all")}
                  style={{
                    height: 34,
                    padding: "0 14px",
                    borderRadius: 999,
                    border: "none",
                    background: retailerRegionFilter === "all" ? BRAND : "#dfe6ef",
                    color: retailerRegionFilter === "all" ? "#fff" : "#556177",
                    fontWeight: 800,
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                  }}
                >
                  All Regions
                </button>
                {CRUNZZO_REGIONS.map((region) => (
                  <button
                    key={region.id}
                    type="button"
                    onClick={() => setRetailerRegionFilter(region.name)}
                    style={{
                      height: 34,
                      padding: "0 14px",
                      borderRadius: 999,
                      border: "none",
                      background: retailerRegionFilter === region.name ? BRAND : "#dfe6ef",
                      color: retailerRegionFilter === region.name ? "#fff" : "#556177",
                      fontWeight: 800,
                      cursor: "pointer",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {region.name}
                  </button>
                ))}
              </div>

              <div style={{ display: "grid", gap: 12 }}>
                {retailerRankings.length ? (
                  retailerRankings.map((retailer, index) => (
                    <SectionCard key={retailer.id}>
                      <div style={{ display: "grid", gridTemplateColumns: "42px minmax(0, 1fr) auto", gap: 12, alignItems: "center" }}>
                        <div
                          style={{
                            width: 42,
                            height: 42,
                            borderRadius: 14,
                            display: "grid",
                            placeItems: "center",
                            background: index === 0 ? BRAND : "#fff0f0",
                            color: index === 0 ? "#fff" : BRAND,
                            fontWeight: 900,
                          }}
                        >
                          #{index + 1}
                        </div>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 14, fontWeight: 900, color: TEXT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {retailer.name}
                          </div>
                          <div style={{ fontSize: 11, color: MUTED, marginTop: 3 }}>
                            {retailer.businessName || retailer.retailerId || "Retailer"} • {retailer.region}
                          </div>
                        </div>
                        <div style={{ textAlign: "right" }}>
                          <div style={{ fontSize: 15, fontWeight: 900, color: BRAND }}>{formatCompact(retailer.totalValue)}</div>
                          <div style={{ fontSize: 10, color: MUTED }}>{retailer.orderCount} orders</div>
                        </div>
                      </div>
                      <div style={{ marginTop: 12, height: 7, borderRadius: 999, background: "#f5d2d4", overflow: "hidden" }}>
                        <div
                          style={{
                            width: `${Math.max(8, Math.round((retailer.totalValue / maxRetailerValue) * 100))}%`,
                            height: "100%",
                            background: BRAND,
                          }}
                        />
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 12 }}>
                        <div style={{ padding: 10, borderRadius: 12, background: "#fafafa" }}>
                          <div style={{ fontSize: 10, color: MUTED, fontWeight: 800 }}>UNITS</div>
                          <strong style={{ display: "block", marginTop: 4 }}>{retailer.totalUnits}</strong>
                        </div>
                        <div style={{ padding: 10, borderRadius: 12, background: "#fafafa" }}>
                          <div style={{ fontSize: 10, color: MUTED, fontWeight: 800 }}>LAST ORDER</div>
                          <strong style={{ display: "block", marginTop: 4, fontSize: 12 }}>{retailer.lastOrderMs ? formatTime(retailer.lastOrderMs) : "-"}</strong>
                        </div>
                      </div>
                    </SectionCard>
                  ))
                ) : (
                  <SectionCard>
                    <div style={{ textAlign: "center", color: MUTED, fontSize: 13 }}>
                      No retailer orders found for this region.
                    </div>
                  </SectionCard>
                )}
              </div>
            </>
          )}

          {activeTab === "notifications" && (
            <>
              <div style={{ marginBottom: 16 }}>
                <h1 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: TEXT }}>
                  Notifications
                </h1>
                <p style={{ margin: "4px 0 0", fontSize: 12, color: MUTED }}>
                  Recent orders, low stock, and no-full-pack alerts.
                </p>
              </div>

              <div style={{ display: "grid", gap: 12 }}>
                {prioritizedAdminNotifications.length ? (
                  prioritizedAdminNotifications.map((item) => {
                    const isViewed = isAppNotificationViewed(item, userProfile?.uid, viewedNotifications);
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => openAdminNotification(item)}
                        style={{
                          display: "block",
                          width: "100%",
                          padding: 0,
                          border: "none",
                          background: "transparent",
                          textAlign: "left",
                          cursor: "pointer",
                          order: isViewed ? 2 : 1,
                        }}
                      >
                        <SectionCard
                          style={{
                            borderColor: isViewed ? BORDER : `${item.tone}55`,
                            opacity: isViewed ? 0.72 : 1,
                            boxShadow: isViewed ? "none" : "0 10px 24px rgba(32, 38, 58, 0.04)",
                          }}
                        >
                          <div style={{ display: "grid", gridTemplateColumns: "10px minmax(0, 1fr)", gap: 12 }}>
                            <div style={{ width: 10, borderRadius: 999, background: isViewed ? "#cfd5df" : item.tone }} />
                            <div style={{ minWidth: 0 }}>
                              <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                                <h2 style={{ margin: 0, fontSize: 14, color: TEXT }}>{item.title}</h2>
                                <span style={{ color: MUTED, fontSize: 10, fontWeight: 800, whiteSpace: "nowrap" }}>{item.time}</span>
                              </div>
                              <p style={{ margin: "6px 0 0", color: MUTED, fontSize: 12, lineHeight: 1.35 }}>{item.message}</p>
                              <span
                                style={{
                                  display: "inline-flex",
                                  marginTop: 9,
                                  padding: "4px 8px",
                                  borderRadius: 999,
                                  background: isViewed ? "#f3f4f6" : "#fff0f0",
                                  color: isViewed ? MUTED : BRAND,
                                  fontSize: 10,
                                  fontWeight: 900,
                                }}
                              >
                                {isViewed ? "Viewed" : "New"}
                              </span>
                            </div>
                          </div>
                        </SectionCard>
                      </button>
                    );
                  })
                ) : (
                  <SectionCard>
                    <div style={{ textAlign: "center", color: MUTED, fontSize: 13 }}>
                      No notifications yet.
                    </div>
                  </SectionCard>
                )}
              </div>
            </>
          )}

          {activeTab === "regions" && (
            <>
              <div style={{ marginBottom: 16 }}>
                <h1 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: TEXT }}>
                  Regional Inventory Allocation
                </h1>
                <p style={{ margin: "4px 0 0", fontSize: 12, color: MUTED }}>
                  Allocate central Crunzzo units across Chennai, Mumbai, and Delhi.
                </p>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10, marginBottom: 14 }}>
                <input
                  placeholder="Search products for allocation..."
                  value={allocationSearch}
                  onChange={(e) => setAllocationSearch(e.target.value)}
                  style={{
                    width: "100%",
                    height: 42,
                    borderRadius: 12,
                    border: `1px solid ${BORDER}`,
                    padding: "0 14px",
                    fontSize: 13,
                    fontWeight: 600,
                    boxSizing: "border-box",
                    outline: "none"
                  }}
                />
                <select
                  value={allocationCategoryFilter}
                  onChange={(e) => setAllocationCategoryFilter(e.target.value)}
                  style={{
                    height: 42,
                    borderRadius: 12,
                    border: `1px solid ${BORDER}`,
                    padding: "0 10px",
                    fontSize: 13,
                    fontWeight: 800,
                    background: "#fff",
                    color: TEXT,
                    outline: "none",
                    minWidth: 100
                  }}
                >
                  <option value="All">All Categories</option>
                  {[...new Set(products.map(p => p.category).filter(Boolean))].sort().map(cat => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
              </div>

              <div style={{ margin: "-4px 2px 12px", color: MUTED, fontSize: 11, fontWeight: 700 }}>
                {filteredAllocationProducts.length} product{filteredAllocationProducts.length === 1 ? "" : "s"} shown. Select a product to manage its allocation.
              </div>

              {allocationMessage ? (
                <div
                  style={{
                    marginBottom: 14,
                    borderRadius: 12,
                    padding: "10px 12px",
                    border: `1px solid ${allocationMessage.includes("saved") ? "#d7f0dc" : "#ffd1d1"}`,
                    background: allocationMessage.includes("saved") ? "#eef9f0" : "#fff0f0",
                    color: allocationMessage.includes("saved") ? "#16803a" : "#d42424",
                    fontSize: 12,
                    fontWeight: 800,
                  }}
                >
                  {allocationMessage}
                </div>
              ) : null}

              <div style={{ display: "grid", gap: 13 }}>
                {filteredAllocationProducts.length ? filteredAllocationProducts.map((product) => {
                  const totalRemainingAllocated = CRUNZZO_REGIONS.reduce(
                    (sum, region) => sum + getRegionalRemainingUnits(getAllocationForRegion(region.id, product.id)),
                    0
                  );
                  const unallocated = Math.max(0, Number(product.stock || 0) - totalRemainingAllocated);
                  const isExpanded = expandedAllocationProductId === product.id;

                  return (
                    <SectionCard key={product.id} style={{ padding: 0, overflow: "hidden" }}>
                      <button
                        type="button"
                        className={`crz-allocation-accordion-trigger${isExpanded ? " is-open" : ""}`}
                        aria-expanded={isExpanded}
                        aria-controls={`allocation-panel-${product.id}`}
                        onClick={() => {
                          setAllocationMessage("");
                          setExpandedAllocationProductId((current) => current === product.id ? null : product.id);
                        }}
                      >
                        <strong style={{ minWidth: 0, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {product.name}
                        </strong>
                        <span className="crz-allocation-chevron" aria-hidden="true">
                          <svg viewBox="0 0 24 24">
                            <path d="m6 9 6 6 6-6" />
                          </svg>
                        </span>
                      </button>

                      <div
                        id={`allocation-panel-${product.id}`}
                        className={`crz-allocation-panel${isExpanded ? " is-open" : ""}`}
                        aria-hidden={!isExpanded}
                      >
                        <div className="crz-allocation-panel-inner">
                          <div className="crz-allocation-panel-content">
                          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", paddingTop: 13 }}>
                            <div style={{ color: MUTED, fontSize: 11 }}>{product.skuCode || product.category || "Crunzzo product"}</div>
                            <div style={{ textAlign: "right" }}>
                              <div style={{ color: BRAND, fontSize: 17, fontWeight: 900 }}>{Number(product.stock || 0)} units</div>
                              <div style={{ color: MUTED, fontSize: 10 }}>central stock</div>
                            </div>
                          </div>

                          <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                            <div style={{ padding: 10, borderRadius: 11, background: "#fafafa" }}>
                              <div style={{ color: MUTED, fontSize: 10, fontWeight: 800 }}>REGIONAL REMAINING</div>
                              <strong style={{ display: "block", marginTop: 5 }}>{totalRemainingAllocated} units</strong>
                            </div>
                            <div style={{ padding: 10, borderRadius: 11, background: "#fff3f3" }}>
                              <div style={{ color: MUTED, fontSize: 10, fontWeight: 800 }}>UNALLOCATED</div>
                              <strong style={{ display: "block", marginTop: 5, color: BRAND }}>{unallocated} units</strong>
                            </div>
                          </div>

                          <div style={{ display: "grid", gap: 10, marginTop: 13 }}>
                            {CRUNZZO_REGIONS.map((region) => {
                              const allocation = getAllocationForRegion(region.id, product.id);
                              const fulfilled = Number(allocation?.fulfilledUnits || 0);
                              const remaining = getRegionalRemainingUnits(allocation);
                              return (
                                <div key={region.id} style={{ display: "grid", gridTemplateColumns: "88px minmax(0, 1fr)", gap: 10, alignItems: "center" }}>
                                  <div>
                                    <strong style={{ fontSize: 12 }}>{region.name}</strong>
                                    <small style={{ display: "block", color: MUTED, marginTop: 3 }}>{fulfilled} fulfilled / {remaining} remaining</small>
                                  </div>
                                  <input
                                    value={getAllocationDraftValue(region.id, product.id)}
                                    onChange={(event) => handleAllocationDraft(product.id, region.id, event.target.value)}
                                    inputMode="numeric"
                                    aria-label={`${region.name} allocation for ${product.name}`}
                                    style={{ width: "100%", height: 42, border: `1px solid ${BORDER}`, borderRadius: 11, padding: "0 12px", fontWeight: 800, boxSizing: "border-box" }}
                                  />
                                </div>
                              );
                            })}
                          </div>

                          <button
                            type="button"
                            onClick={() => saveRegionalAllocation(product)}
                            disabled={savingAllocationId === product.id}
                            style={{ marginTop: 14, width: "100%", height: 42, border: "none", borderRadius: 11, background: BRAND, color: "#fff", fontWeight: 900, cursor: "pointer", opacity: savingAllocationId === product.id ? 0.6 : 1 }}
                          >
                            {savingAllocationId === product.id ? "Saving..." : "Save Regional Allocation"}
                          </button>
                          </div>
                        </div>
                      </div>
                    </SectionCard>
                  );
                }) : <SectionCard><div style={{ textAlign: "center", color: MUTED }}>Add products before allocating regional inventory.</div></SectionCard>}
              </div>
            </>
          )}

          {activeTab === "products" && (
            <>
              <div style={{ marginBottom: 12 }}>
                <h1 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: TEXT }}>
                  Add New Product
                </h1>
                <p style={{ margin: "4px 0 0", fontSize: 12, color: MUTED }}>
                  Define specifications and inventory details for your catalogue.
                </p>
              </div>

              <div style={{ background: "#fff", padding: 0 }}>
                <div
                  style={{
                    ...PRODUCT_LABEL_STYLE,
                    textAlign: "center",
                    marginBottom: 10,
                    letterSpacing: "0.04em",
                  }}
                >
                  ADD PRODUCT PHOTO
                </div>

                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  style={{
                    width: "100%",
                    minHeight: 180,
                    borderRadius: 18,
                    border: "1.5px dashed #f3c0c2",
                    background: "#fff8f8",
                    display: "grid",
                    placeItems: "center",
                    cursor: "pointer",
                    overflow: "hidden",
                  }}
                >
                  {imagePreview ? (
                    <img
                      src={imagePreview}
                      alt="Preview"
                      style={{ width: "100%", height: 180, objectFit: "contain" }}
                    />
                  ) : (
                    <div style={{ textAlign: "center" }}>
                      <div style={{ fontSize: 26, color: BRAND }}>☁</div>
                      <div
                        style={{
                          marginTop: 8,
                          fontSize: 13,
                          color: BRAND,
                          fontWeight: 800,
                        }}
                      >
                        Upload Image
                      </div>
                      <div style={{ marginTop: 4, fontSize: 10, color: MUTED }}>
                        DRAG AND DROP OR CLICK
                      </div>
                    </div>
                  )}
                </button>

                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={handleImagePick}
                />

                <div
                  style={{
                    marginTop: 12,
                    borderRadius: 12,
                    background: "#fafafa",
                    padding: 10,
                    fontSize: 10,
                    color: MUTED,
                  }}
                >
                  RECOMMENDED: 1080x1080PX, HIGH RESOLUTION PNG OR JPG.
                </div>

                <div style={{ display: "grid", gap: 12, marginTop: 16 }}>
                  <label style={{ display: "grid", gap: 6 }}>
                    <span style={PRODUCT_LABEL_STYLE}>
                      PRODUCT NAME
                    </span>
                    <input
                      name="name"
                      value={productForm.name}
                      onChange={handleProductInput}
                      placeholder="e.g. Crunzzo Cream & Onion Chips"
                      style={{
                        ...PRODUCT_FIELD_TEXT_STYLE,
                        height: 48,
                        borderRadius: 12,
                        border: `1px solid ${BORDER}`,
                        padding: "0 14px",
                        outline: "none",
                        background: "#fff",
                      }}
                    />
                  </label>

                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                            gap: 10,
                          }}
                        >
                          <label style={{ display: "grid", gap: 6 }}>
                            <span style={PRODUCT_LABEL_STYLE}>QUANTITY</span>
                            <input
                              name="stock"
                              value={productForm.stock}
                              onChange={handleProductInput}
                              placeholder="0"
                              inputMode="numeric"
                              style={{
                                ...PRODUCT_FIELD_TEXT_STYLE,
                                height: 48,
                                borderRadius: 12,
                                border: `1px solid ${BORDER}`,
                                padding: "0 14px",
                                outline: "none",
                                background: "#fff",
                              }}
                            />
                          </label>
                          <label style={{ display: "grid", gap: 6 }}>
                            <span style={PRODUCT_LABEL_STYLE}>GST (%)</span>
                            <input
                              name="gst"
                              value={productForm.gst}
                              onChange={handleProductInput}
                              placeholder="18"
                              inputMode="numeric"
                              style={{
                                ...PRODUCT_FIELD_TEXT_STYLE,
                                height: 48,
                                borderRadius: 12,
                                border: `1px solid ${BORDER}`,
                                padding: "0 14px",
                                outline: "none",
                                background: "#fff",
                              }}
                            />
                          </label>
                          <label style={{ display: "grid", gap: 6 }}>
                            <span style={PRODUCT_LABEL_STYLE}>LOW STOCK</span>
                            <input
                              name="lowStockThreshold"
                              value={productForm.lowStockThreshold}
                              onChange={handleProductInput}
                              placeholder="20"
                              inputMode="numeric"
                              style={{
                                ...PRODUCT_FIELD_TEXT_STYLE,
                                height: 48,
                                borderRadius: 12,
                                border: `1px solid ${BORDER}`,
                                padding: "0 14px",
                                outline: "none",
                                background: "#fff",
                              }}
                            />
                          </label>
                          <label style={{ display: "grid", gap: 6 }}>
                            <span style={PRODUCT_LABEL_STYLE}>RETAIL OFFER (%)</span>
                            <input
                              name="retailerOfferPercent"
                              value={productForm.retailerOfferPercent}
                              onChange={handleProductInput}
                              placeholder="0"
                              inputMode="numeric"
                              style={{
                                ...PRODUCT_FIELD_TEXT_STYLE,
                                height: 48,
                                borderRadius: 12,
                                border: `1px solid ${BORDER}`,
                                padding: "0 14px",
                                outline: "none",
                                background: "#fff",
                              }}
                            />
                          </label>
                        </div>

                  <div style={{ display: "grid", gap: 10 }}>
                    <span style={PRODUCT_LABEL_STYLE}>PACK PRICING & STOCK</span>
                    {CRUNZZO_PACKS.map((pack) => (
                      <div
                        key={pack.id}
                        style={{
                          border: `1px solid ${BORDER}`,
                          borderRadius: 14,
                          padding: 12,
                          background: "#fff",
                          display: "grid",
                          gap: 10,
                        }}
                      >
                        <div style={{ fontSize: 14, fontWeight: 900, color: TEXT }}>
                          Pack of {productForm[`${pack.id}Size`] || pack.packSize}
                        </div>
                        <label style={{ display: "grid", gap: 6 }}>
                          <span style={PRODUCT_LABEL_STYLE}>PRICING GROUP</span>
                          <select
                            name={`${pack.id}PricingGroup`}
                            value={productForm[`${pack.id}PricingGroup`]}
                            onChange={handleProductInput}
                            style={{
                              ...PRODUCT_FIELD_TEXT_STYLE,
                              height: 44,
                              borderRadius: 12,
                              border: `1px solid ${BORDER}`,
                              padding: "0 12px",
                              outline: "none",
                              background: "#fff",
                            }}
                          >
                            {PRICING_GROUPS.map((item) => (
                              <option key={item} value={item}>
                                {item}
                              </option>
                            ))}
                          </select>
                        </label>
                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
                            gap: 10,
                          }}
                        >
                          <label style={{ display: "grid", gap: 6 }}>
                            <span style={PRODUCT_LABEL_STYLE}>SIZE (UNITS)</span>
                            <input
                              name={`${pack.id}Size`}
                              value={productForm[`${pack.id}Size`]}
                              onChange={handleProductInput}
                              placeholder={String(pack.packSize)}
                              inputMode="numeric"
                              style={{
                                ...PRODUCT_FIELD_TEXT_STYLE,
                                height: 44,
                                borderRadius: 12,
                                border: `1px solid ${BORDER}`,
                                padding: "0 12px",
                                outline: "none",
                                background: "#fff",
                              }}
                            />
                          </label>
                          <label style={{ display: "grid", gap: 6 }}>
                            <span style={PRODUCT_LABEL_STYLE}>PRICE (₹)</span>
                            <input
                              name={`${pack.id}Rate`}
                              value={productForm[`${pack.id}Rate`]}
                              onChange={handleProductInput}
                              placeholder="0"
                              inputMode="numeric"
                              style={{
                                ...PRODUCT_FIELD_TEXT_STYLE,
                                height: 44,
                                borderRadius: 12,
                                border: `1px solid ${BORDER}`,
                                padding: "0 12px",
                                outline: "none",
                                background: "#fff",
                              }}
                            />
                          </label>
                        </div>
                      </div>
                    ))}
                  </div>

                  <label style={{ display: "grid", gap: 6 }}>
                    <span style={PRODUCT_LABEL_STYLE}>
                      PRODUCT DESCRIPTION
                    </span>
                    <textarea
                      name="description"
                      value={productForm.description}
                      onChange={handleProductInput}
                      placeholder="Enter detailed product specifications..."
                      rows={4}
                      style={{
                        ...PRODUCT_FIELD_TEXT_STYLE,
                        minHeight: 108,
                        borderRadius: 12,
                        border: `1px solid ${BORDER}`,
                        padding: 14,
                        outline: "none",
                        resize: "vertical",
                        fontFamily: "inherit",
                        background: "#fff",
                      }}
                    />
                  </label>

                  <label style={{ display: "grid", gap: 6 }}>
                    <span style={PRODUCT_LABEL_STYLE}>
                      CATEGORY
                    </span>
                    <select
                      name="category"
                      value={productForm.category}
                      onChange={handleProductCategoryChange}
                      style={{
                        ...PRODUCT_FIELD_TEXT_STYLE,
                        height: 48,
                        borderRadius: 12,
                        border: `1px solid ${BORDER}`,
                        padding: "0 14px",
                        outline: "none",
                        background: "#fff",
                      }}
                    >
                      {categoryOptions.map((item) => (
                        <option key={item} value={item}>
                          {item}
                        </option>
                      ))}
                      <option value={ADD_CATEGORY_VALUE}>+ Add new category</option>
                    </select>
                  </label>

                  <div style={{ display: "grid", gap: 6 }}>
                    <span style={PRODUCT_LABEL_STYLE}>
                      DISTRIBUTION PER ZONE
                    </span>

                    <div
                      style={{
                        display: "flex",
                        alignItems: "stretch",
                        gap: 10,
                        width: "100%",
                        flexWrap: "nowrap",
                      }}
                    >
                      <input
                        value={zoneInput}
                        onChange={(e) => setZoneInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            handleAddZone();
                          }
                        }}
                        placeholder="Type your own zone"
                        style={{
                          ...PRODUCT_FIELD_TEXT_STYLE,
                          flex: "1 1 0",
                          width: "auto",
                          minWidth: 0,
                          height: 48,
                          borderRadius: 12,
                          border: `1px solid ${BORDER}`,
                          padding: "0 14px",
                          outline: "none",
                          boxSizing: "border-box",
                          background: "#fff",
                        }}
                      />

                      <button
                        type="button"
                        onClick={handleAddZone}
                        style={{
                          flex: "0 0 76px",
                          width: 76,
                          height: 48,
                          border: "none",
                          borderRadius: 12,
                          background: BRAND,
                          color: "#fff",
                          fontSize: 14,
                          fontWeight: 800,
                          cursor: "pointer",
                          boxSizing: "border-box",
                        }}
                      >
                        Add
                      </button>
                    </div>

                    {productForm.zones.length > 0 ? (
                      <div
                        style={{
                          display: "flex",
                          flexWrap: "wrap",
                          gap: 8,
                          marginTop: 2,
                        }}
                      >
                        {productForm.zones.map((zone) => (
                          <div
                            key={zone}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 8,
                              padding: "8px 12px",
                              borderRadius: 999,
                              background: "#fff",
                              border: `1px solid ${BORDER}`,
                              color: TEXT,
                              fontSize: 12,
                              fontWeight: 700,
                              maxWidth: "100%",
                              boxSizing: "border-box",
                            }}
                          >
                            <span style={{ wordBreak: "break-word" }}>{zone}</span>
                            <button
                              type="button"
                              onClick={() => removeZone(zone)}
                              style={{
                                border: "none",
                                background: "transparent",
                                color: BRAND,
                                cursor: "pointer",
                                fontWeight: 800,
                                padding: 0,
                                lineHeight: 1,
                                flexShrink: 0,
                              }}
                            >
                              ✕
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : null}

                    <div
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        gap: 8,
                        marginTop: 4,
                      }}
                    >
                      {ZONES.map((zone) => (
                        <button
                          key={zone}
                          type="button"
                          onClick={() => addZoneFromValue(zone)}
                          style={{
                            height: 34,
                            padding: "0 12px",
                            borderRadius: 999,
                            border: `1px solid ${BORDER}`,
                            background: "#fff",
                            color: TEXT,
                            fontSize: 12,
                            fontWeight: 600,
                            cursor: "pointer",
                            maxWidth: "100%",
                            boxSizing: "border-box",
                          }}
                        >
                          + {zone}
                        </button>
                      ))}
                    </div>
                  </div>

                  <label style={{ display: "grid", gap: 6 }}>
                    <span style={PRODUCT_LABEL_STYLE}>
                      PRODUCT SKU
                    </span>
                    <input
                      name="skuCode"
                      value={productForm.skuCode}
                      onChange={handleProductInput}
                      placeholder="e.g. CRZ-001"
                      style={{
                        ...PRODUCT_FIELD_TEXT_STYLE,
                        height: 48,
                        borderRadius: 12,
                        border: `1px solid ${BORDER}`,
                        padding: "0 14px",
                        outline: "none",
                        background: "#fff",
                      }}
                    />
                  </label>

                </div>

                {productMessage ? (
                  <div
                    style={{
                      marginTop: 14,
                      background: productMessage.includes("successfully")
                        ? "#eef9f0"
                        : "#fff0f0",
                      color: productMessage.includes("successfully") ? "#27944e" : "#d42424",
                      border: `1px solid ${
                        productMessage.includes("successfully") ? "#d7f0dc" : "#ffd1d1"
                      }`,
                      borderRadius: 12,
                      padding: "10px 12px",
                      fontSize: 13,
                      fontWeight: 700,
                    }}
                  >
                    {productMessage}
                  </div>
                ) : null}

                <button
                  type="button"
                  onClick={handleSaveProduct}
                  disabled={savingProduct}
                  style={{
                    marginTop: 16,
                    width: "100%",
                    height: 46,
                    borderRadius: 12,
                    border: "none",
                    background: BRAND,
                    color: "#fff",
                    fontWeight: 800,
                    cursor: "pointer",
                  }}
                >
                  {savingProduct ? "Saving..." : "SAVE PRODUCT"}
                </button>

                <button
                  type="button"
                  onClick={resetProductForm}
                  style={{
                    marginTop: 10,
                    width: "100%",
                    height: 42,
                    borderRadius: 12,
                    border: `1px solid ${BORDER}`,
                    background: "#fff",
                    color: TEXT,
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  DISCARD DRAFT
                </button>
              </div>
            </>
          )}

          {activeTab === "inventory" && (
            <>
              <div style={{ marginBottom: 16 }}>
                <h1 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: TEXT }}>
                  Inventory
                </h1>
                <p style={{ margin: "4px 0 0", fontSize: 12, color: MUTED }}>
                  Manage live stock, low stock alerts, and product values.
                </p>
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(3, 1fr)",
                  gap: 8,
                  marginBottom: 14,
                }}
              >
                <SectionCard style={{ padding: "12px 4px", textAlign: "center" }}>
                  <div
                    style={{
                      fontSize: 11,
                      color: TEXT,
                      fontWeight: 900,
                      lineHeight: 1.2,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      height: 28,
                      textAlign: "center",
                    }}
                    title="TOTAL PRODUCTS"
                  >
                    TOTAL PRODUCTS
                  </div>
                  <div style={{ marginTop: 6, fontSize: 20, fontWeight: 900, color: BRAND }}>
                    {products.length}
                  </div>
                </SectionCard>

                <SectionCard style={{ padding: "12px 4px", textAlign: "center" }}>
                  <div
                    style={{
                      fontSize: 11,
                      color: TEXT,
                      fontWeight: 900,
                      lineHeight: 1.2,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      height: 28,
                      textAlign: "center",
                    }}
                    title="LOW STOCK ALERTS"
                  >
                    LOW STOCK ALERTS
                  </div>
                  <div style={{ marginTop: 6, fontSize: 20, fontWeight: 900, color: BRAND }}>
                    {lowStockCount}
                  </div>
                </SectionCard>

                <SectionCard style={{ padding: "12px 4px", textAlign: "center" }}>
                  <div
                    style={{
                      fontSize: 11,
                      color: TEXT,
                      fontWeight: 900,
                      lineHeight: 1.2,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      height: 28,
                      textAlign: "center",
                    }}
                    title="INVENTORY VALUE"
                  >
                    INVENTORY VALUE
                  </div>
                  <div style={{ marginTop: 6, fontSize: 20, fontWeight: 900, color: TEXT }}>
                    {formatCompact(inventoryValue)}
                  </div>
                </SectionCard>
              </div>

              <SectionCard>
                <input
                  value={inventorySearch}
                  onChange={(e) => setInventorySearch(e.target.value)}
                  placeholder="Search product, SKU or category..."
                  style={{
                    width: "100%",
                    height: 42,
                    borderRadius: 12,
                    border: `1px solid ${BORDER}`,
                    padding: "0 14px",
                    outline: "none",
                    fontSize: 13,
                  }}
                />
              </SectionCard>

              <div style={{ height: 14 }} />

              <div style={{ display: "grid", gap: 12 }}>
                {filteredInventory.length ? (
                  filteredInventory.map((item) => {
                    const packOptions = normalizeCrunzzoPackOptions(item);
                    const totalUnits = getCrunzzoTotalUnits(item);
                    const lowStock = isCrunzzoLowStock(item);
                    const isEditing = editingProductId === item.id;
                    const retailerOfferPercent = Math.min(
                      100,
                      Number(item.retailerOfferPercent ?? item.offerPercent ?? 0)
                    );

                    return (
                      <SectionCard key={item.id}>
                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: "64px minmax(0, 1fr)",
                            gap: 12,
                            alignItems: "center",
                          }}
                        >
                          <div
                            style={{
                              width: 64,
                              height: 80,
                              borderRadius: 14,
                              overflow: "hidden",
                              background: "#f9f9f9",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              border: `1px solid ${BORDER}`,
                            }}
                          >
                            {item.imageUrl ? (
                              <img
                                src={item.imageUrl}
                                alt={item.name}
                                style={{
                                  maxWidth: "100%",
                                  maxHeight: "100%",
                                  objectFit: "contain",
                                  padding: 4,
                                  boxSizing: "border-box"
                                }}
                              />
                            ) : (
                              <img
                                src={crunzzoLogo}
                                alt="Crunzzo"
                                style={{
                                  maxWidth: "100%",
                                  maxHeight: "100%",
                                  objectFit: "contain",
                                  padding: 10,
                                  boxSizing: "border-box"
                                }}
                              />
                            )}
                          </div>

                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: 14, fontWeight: 800, color: TEXT }}>
                              {item.name}
                            </div>
                            <div style={{ fontSize: 11, color: MUTED, marginTop: 3 }}>
                              {item.category || "Snacks"} • {item.skuCode || "No SKU"}
                            </div>
                            {retailerOfferPercent > 0 ? (
                              <div style={{ fontSize: 11, color: BRAND, marginTop: 5, fontWeight: 800 }}>
                                Retailer offer {retailerOfferPercent}% off
                              </div>
                            ) : null}
                            <div
                              style={{
                                fontSize: 11,
                                color: lowStock ? BRAND : "#27944e",
                                marginTop: 6,
                                fontWeight: 700,
                              }}
                            >
                              {totalUnits} units total {lowStock ? "• LOW STOCK" : ""}
                            </div>
                          </div>

                          <div style={{ gridColumn: "1 / -1", textAlign: "left" }}>
                            <div style={{ fontSize: 14, fontWeight: 800, color: TEXT }}>
                              {formatCompact(getCrunzzoInventoryValue(item))}
                            </div>
                            <div style={{ fontSize: 11, color: MUTED, marginTop: 4 }}>stock value</div>
                          </div>
                        </div>

                        <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
                          {packOptions.map((pack) => (
                            <div
                              key={pack.id}
                              style={{
                                display: "grid",
                                gridTemplateColumns: "minmax(0, 1fr) auto",
                                gap: 10,
                                alignItems: "center",
                                border: `1px solid ${BORDER}`,
                                borderRadius: 12,
                                padding: "9px 10px",
                                background: "#fff",
                              }}
                            >
                              <div style={{ minWidth: 0 }}>
                                <div style={{ fontSize: 12, fontWeight: 900, color: TEXT }}>
                                  {pack.label}
                                </div>
                                <div style={{ fontSize: 11, color: MUTED, marginTop: 3 }}>
                                  {pack.pricingGroup} • {pack.stock} packs • {pack.stock * pack.packSize} units • GST {pack.gst}%
                                </div>
                              </div>
                              <div style={{ fontSize: 12, fontWeight: 900, color: BRAND }}>
                                {formatRupees(pack.rate)}
                              </div>
                            </div>
                          ))}
                        </div>

                        {isEditing ? (
                          <div
                            style={{
                              marginTop: 14,
                              padding: 12,
                              border: `1px solid ${BORDER}`,
                              borderRadius: 14,
                              background: "#fafafa",
                              display: "grid",
                              gap: 12,
                            }}
                          >
                            <div
                              style={{
                                display: "grid",
                                gridTemplateColumns: "minmax(0, 1fr) auto",
                                gap: 8,
                                alignItems: "center",
                                marginBottom: 2,
                                width: "100%",
                                boxSizing: "border-box",
                              }}
                            >
                              <div style={{ minWidth: 0, fontSize: 11, fontWeight: 900, color: BRAND, letterSpacing: 0.5 }}>
                                EDITING MODE
                              </div>
                              <button
                                type="button"
                                onClick={() => handleSaveProductEdit(item)}
                                disabled={savingProductEdit}
                                style={{
                                  height: 28,
                                  minWidth: 0,
                                  maxWidth: "100%",
                                  padding: "0 12px",
                                  borderRadius: 999,
                                  border: "none",
                                  background: BRAND,
                                  color: "#fff",
                                  fontSize: 10,
                                  fontWeight: 900,
                                  cursor: savingProductEdit ? "not-allowed" : "pointer",
                                  whiteSpace: "nowrap",
                                  boxShadow: "0 2px 8px rgba(229, 31, 40, 0.25)"
                                }}
                              >
                                {savingProductEdit ? "SAVING..." : "SAVE"}
                              </button>
                            </div>

                            <label style={{ display: "grid", gap: 6, color: TEXT, fontSize: 12, fontWeight: 900 }}>
                              Product Name
                              <input
                                name="name"
                                value={editingProductForm.name || ""}
                                onChange={handleProductEditInput}
                                placeholder="Product name"
                                style={{
                                  height: 42,
                                  borderRadius: 12,
                                  border: `1px solid ${BORDER}`,
                                  padding: "0 12px",
                                  outline: "none",
                                  background: "#fff",
                                  color: TEXT,
                                  fontWeight: 700,
                                }}
                              />
                            </label>

                            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
                              <label style={{ display: "grid", gap: 5, fontSize: 11, fontWeight: 800, color: TEXT }}>
                                Category
                                <select
                                  name="category"
                                  value={editingProductForm.category || ""}
                                  onChange={handleProductEditInput}
                                  style={{
                                    width: "100%",
                                    boxSizing: "border-box",
                                    height: 38,
                                    borderRadius: 10,
                                    border: `1px solid ${BORDER}`,
                                    padding: "0 10px",
                                    outline: "none",
                                    background: "#fff",
                                    fontWeight: 700,
                                  }}
                                >
                                  {CATEGORY_OPTIONS.map((cat) => (
                                    <option key={cat} value={cat}>
                                      {cat}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <label style={{ display: "grid", gap: 5, fontSize: 11, fontWeight: 800, color: TEXT }}>
                                SKU Code
                                <input
                                  name="skuCode"
                                  value={editingProductForm.skuCode || ""}
                                  onChange={handleProductEditInput}
                                  placeholder="SKU"
                                  style={{
                                    width: "100%",
                                    boxSizing: "border-box",
                                    height: 38,
                                    borderRadius: 10,
                                    border: `1px solid ${BORDER}`,
                                    padding: "0 10px",
                                    outline: "none",
                                    background: "#fff",
                                    fontWeight: 700,
                                  }}
                                />
                              </label>
                            </div>

                            <div
                              style={{
                                display: "grid",
                                gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                                gap: 8,
                                marginBottom: 4,
                              }}
                            >
                              <label style={{ display: "grid", gap: 5, fontSize: 11, fontWeight: 800, color: TEXT }}>
                                Stock
                                <input
                                  name="stock"
                                  value={editingProductForm.stock ?? ""}
                                  onChange={handleProductEditInput}
                                  placeholder="0"
                                  inputMode="numeric"
                                  style={{
                                    width: "100%",
                                    boxSizing: "border-box",
                                    height: 38,
                                    borderRadius: 10,
                                    border: `1px solid ${BORDER}`,
                                    padding: "0 10px",
                                    outline: "none",
                                    background: "#fff",
                                    fontWeight: 700,
                                  }}
                                />
                              </label>
                              <label style={{ display: "grid", gap: 5, fontSize: 11, fontWeight: 800, color: TEXT }}>
                                GST %
                                <input
                                  name="gst"
                                  value={editingProductForm.gst ?? ""}
                                  onChange={handleProductEditInput}
                                  placeholder="18"
                                  inputMode="numeric"
                                  style={{
                                    width: "100%",
                                    boxSizing: "border-box",
                                    height: 38,
                                    borderRadius: 10,
                                    border: `1px solid ${BORDER}`,
                                    padding: "0 10px",
                                    outline: "none",
                                    background: "#fff",
                                    fontWeight: 700,
                                  }}
                                />
                              </label>
                              <label style={{ display: "grid", gap: 5, fontSize: 11, fontWeight: 800, color: TEXT }}>
                                Low Stock
                                <input
                                  name="lowStockThreshold"
                                  value={editingProductForm.lowStockThreshold ?? ""}
                                  onChange={handleProductEditInput}
                                  placeholder="0"
                                  inputMode="numeric"
                                  style={{
                                    width: "100%",
                                    boxSizing: "border-box",
                                    height: 38,
                                    borderRadius: 10,
                                    border: `1px solid ${BORDER}`,
                                    padding: "0 10px",
                                    outline: "none",
                                    background: "#fff",
                                    fontWeight: 700,
                                  }}
                                />
                              </label>
                              <label style={{ display: "grid", gap: 5, fontSize: 11, fontWeight: 800, color: TEXT }}>
                                Retail Offer %
                                <input
                                  name="retailerOfferPercent"
                                  value={editingProductForm.retailerOfferPercent ?? ""}
                                  onChange={handleProductEditInput}
                                  placeholder="0"
                                  inputMode="numeric"
                                  style={{
                                    width: "100%",
                                    boxSizing: "border-box",
                                    height: 38,
                                    borderRadius: 10,
                                    border: `1px solid ${BORDER}`,
                                    padding: "0 10px",
                                    outline: "none",
                                    background: "#fff",
                                    fontWeight: 700,
                                  }}
                                />
                              </label>
                            </div>

                            {CRUNZZO_PACKS.map((pack) => (
                              <div
                                key={pack.id}
                                style={{
                                  border: `1px solid ${BORDER}`,
                                  borderRadius: 12,
                                  padding: 10,
                                  background: "#fdfdfd",
                                  display: "grid",
                                  gap: 10,
                                }}
                              >
                                <div style={{ fontSize: 13, fontWeight: 900, color: TEXT }}>
                                  Pack Settings ({editingProductForm[`${pack.id}Size`] || pack.packSize} units)
                                </div>
                                <label style={{ display: "grid", gap: 5, fontSize: 11, fontWeight: 800, color: TEXT }}>
                                  Pricing Group
                                  <select
                                    name={`${pack.id}PricingGroup`}
                                    value={editingProductForm[`${pack.id}PricingGroup`] || "Standard Retail"}
                                    onChange={handleProductEditInput}
                                    style={{
                                      width: "100%",
                                      boxSizing: "border-box",
                                      height: 38,
                                      borderRadius: 10,
                                      border: `1px solid ${BORDER}`,
                                      padding: "0 10px",
                                      outline: "none",
                                      background: "#fff",
                                      fontWeight: 700,
                                    }}
                                  >
                                    {PRICING_GROUPS.map((item) => (
                                      <option key={item} value={item}>
                                        {item}
                                      </option>
                                    ))}
                                  </select>
                                </label>
                                <div
                                  style={{
                                    display: "grid",
                                    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                                    gap: 12,
                                  }}
                                >
                                  {[
                                    ["Size", "Pack Size"],
                                    ["Rate", "Price"],
                                  ].map(([suffix, label]) => (
                                    <label key={suffix} style={{ display: "grid", gap: 5, fontSize: 11, fontWeight: 800, color: TEXT }}>
                                      {label}
                                      <input
                                        name={`${pack.id}${suffix}`}
                                        value={editingProductForm[`${pack.id}${suffix}`] || ""}
                                        onChange={handleProductEditInput}
                                        inputMode="numeric"
                                        style={{
                                          width: "100%",
                                          boxSizing: "border-box",
                                          height: 38,
                                          borderRadius: 10,
                                          border: `1px solid ${BORDER}`,
                                          padding: "0 10px",
                                          outline: "none",
                                          background: "#fff",
                                          fontWeight: 700,
                                        }}
                                      />
                                    </label>
                                  ))}
                                </div>
                              </div>
                            ))}

                            <div style={{
                              display: "grid",
                              gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                              gap: 8,
                              marginTop: 10,
                              width: "100%",
                              boxSizing: "border-box",
                            }}>
                              <button
                                type="button"
                                onClick={() => handleSaveProductEdit(item)}
                                disabled={savingProductEdit}
                                style={{
                                  height: 30,
                                  width: "100%",
                                  padding: "0 12px",
                                  borderRadius: 999,
                                  border: "none",
                                  background: BRAND,
                                  color: "#fff",
                                  fontSize: 11,
                                  fontWeight: 800,
                                  cursor: savingProductEdit ? "not-allowed" : "pointer",
                                }}
                              >
                                {savingProductEdit ? "Saving..." : "Save"}
                              </button>
                              <button
                                type="button"
                                onClick={cancelProductEdit}
                                disabled={savingProductEdit}
                                style={{
                                  height: 30,
                                  width: "100%",
                                  padding: "0 12px",
                                  borderRadius: 999,
                                  border: `1px solid ${BORDER}`,
                                  background: "#fff",
                                  color: MUTED,
                                  fontSize: 11,
                                  fontWeight: 700,
                                  cursor: savingProductEdit ? "not-allowed" : "pointer",
                                }}
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : null}

                        <div
                          style={{
                            marginTop: 12,
                            display: "flex",
                            justifyContent: "flex-start",
                            alignItems: "center",
                            gap: 12,
                            flexWrap: "wrap",
                          }}
                        >
                          <div
                            style={{
                              display: "flex",
                              gap: 8,
                              flexWrap: "wrap",
                              justifyContent: "flex-start",
                              width: "100%",
                            }}
                          >
                            <button
                              type="button"
                              onClick={isEditing ? () => handleSaveProductEdit(item) : () => startProductEdit(item)}
                              style={{
                                height: 34,
                                padding: "0 14px",
                                borderRadius: 999,
                                border: `1px solid ${isEditing ? BRAND : BORDER}`,
                                background: isEditing ? BRAND : "#fff",
                                color: isEditing ? "#fff" : TEXT,
                                fontWeight: 800,
                                cursor: "pointer",
                              }}
                            >
                              {isEditing ? "Save" : "Edit"}
                            </button>

                            <button
                              type="button"
                              onClick={() => toggleProductStatus(item)}
                              style={{
                                height: 34,
                                padding: "0 12px",
                                borderRadius: 999,
                                border: `1px solid ${item.status === "inactive" ? BRAND : BORDER}`,
                                background: item.status === "inactive" ? "#fdeeee" : "#fff",
                                color: item.status === "inactive" ? BRAND : TEXT,
                                fontWeight: 700,
                                cursor: "pointer",
                              }}
                            >
                              {item.status === "inactive" ? "Inactive" : "Active"}
                            </button>

                            <button
                              type="button"
                              onClick={() => handleDeleteProduct(item)}
                              style={{
                                height: 34,
                                padding: "0 12px",
                                borderRadius: 999,
                                border: `1px solid #ffd1d1`,
                                background: "#fff6f6",
                                color: BRAND,
                                fontWeight: 700,
                                cursor: "pointer",
                              }}
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      </SectionCard>
                    );
                  })
                ) : (
                  <SectionCard>
                    <div style={{ textAlign: "center", color: MUTED, fontSize: 13 }}>
                      No products found.
                    </div>
                  </SectionCard>
                )}
              </div>
            </>
          )}
        </div>

        <div
          className="admin-footer-bar"
          style={{
            flexShrink: 0,
            background: "#fff",
            borderTop: `1px solid ${BORDER}`,
            padding: "8px 10px",
          }}
        >
          <div
            style={{
              display: "flex",
              gap: 4,
              background: "#fff",
              border: `1px solid ${BORDER}`,
              borderRadius: 16,
              padding: 4,
              overflow: "hidden",
            }}
          >
            <AdminTab
              label="Dashboard"
              active={activeTab === "dashboard"}
              onClick={() => goToTab("dashboard")}
            />
            <AdminTab
              label="Sales"
              active={activeTab === "sales"}
              onClick={() => goToTab("sales")}
            />
            <AdminTab
              label="Regions"
              active={activeTab === "regions"}
              onClick={() => goToTab("regions")}
            />
            <AdminTab
              label="Products"
              active={activeTab === "products"}
              onClick={() => goToTab("products")}
            />
            <AdminTab
              label="Inventory"
              active={activeTab === "inventory"}
              onClick={() => goToTab("inventory")}
            />
          </div>
        </div>
      </div>

      {selectedNotification ? (
        <div
          className="crz-logout-overlay"
          role="presentation"
          onClick={() => setSelectedNotification(null)}
        >
          <div
            className="crz-logout-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="admin-notification-detail-title"
            onClick={(event) => event.stopPropagation()}
            style={{ textAlign: "left", maxWidth: 380 }}
          >
            <div
              style={{
                width: 12,
                height: 44,
                borderRadius: 999,
                background: selectedNotification.tone,
                marginBottom: 12,
              }}
            />
            <h3 id="admin-notification-detail-title" style={{ marginBottom: 6 }}>
              {selectedNotification.title}
            </h3>
            <p style={{ margin: "0 0 12px", color: MUTED, fontSize: 12 }}>
              {selectedNotification.time}
            </p>
            <p style={{ margin: "0 0 12px", color: TEXT, fontSize: 13, lineHeight: 1.45 }}>
              {selectedNotification.message}
            </p>
            <div
              style={{
                padding: 12,
                borderRadius: 12,
                background: "#f7f8fb",
                color: TEXT,
                fontSize: 12,
                lineHeight: 1.5,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {selectedNotification.detail || selectedNotification.message}
            </div>
            <button
              type="button"
              className="crz-logout-confirm czd-logout-confirm"
              onClick={() => setSelectedNotification(null)}
              style={{ width: "100%", marginTop: 14 }}
            >
              Close
            </button>
          </div>
        </div>
      ) : null}

      <CategoryModal
        open={categoryModalOpen}
        value={newCategoryName}
        error={newCategoryError}
        onChange={(value) => {
          setNewCategoryName(value);
          setNewCategoryError("");
        }}
        onClose={closeCategoryModal}
        onSubmit={submitNewCategory}
      />

      {allocationErrorModal ? (
        <div
          className="crz-allocation-error-overlay"
          role="presentation"
          onClick={() => setAllocationErrorModal(null)}
        >
          <div
            className="crz-allocation-error-modal"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="allocation-error-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="crz-allocation-error-icon" aria-hidden="true">!</div>
            <h3 id="allocation-error-title">{allocationErrorModal.title}</h3>
            <p className="crz-allocation-error-product">{allocationErrorModal.productName}</p>

            {Number.isFinite(allocationErrorModal.totalRemainingAllocation) ? (
              <div className="crz-allocation-error-summary">
                <div>
                  <span>Regional total</span>
                  <strong>{allocationErrorModal.totalRemainingAllocation} units</strong>
                </div>
                <div>
                  <span>Central stock</span>
                  <strong>{allocationErrorModal.centralStock} units</strong>
                </div>
                <div className="crz-allocation-error-excess">
                  <span>Reduce allocation by</span>
                  <strong>{allocationErrorModal.excessUnits} units</strong>
                </div>
              </div>
            ) : null}

            <p className="crz-allocation-error-message">{allocationErrorModal.message}</p>
            <button
              type="button"
              className="crz-allocation-error-action"
              onClick={() => setAllocationErrorModal(null)}
            >
              Review Allocations
            </button>
          </div>
        </div>
      ) : null}

      {showLogoutConfirm && (
        <div className="crz-logout-overlay" onClick={() => setShowLogoutConfirm(false)}>
          <div className="crz-logout-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Logout</h3>
            <p>Are you sure you want to logout?</p>
            <div className="crz-logout-actions">
              <button className="crz-logout-cancel" onClick={() => setShowLogoutConfirm(false)}>Cancel</button>
              <button className="crz-logout-confirm czd-logout-confirm" onClick={handleLogout}>Yes</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
