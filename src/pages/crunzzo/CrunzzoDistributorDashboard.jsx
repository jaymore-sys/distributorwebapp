import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { onAuthStateChanged, signOut } from "firebase/auth";
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import crunzzoLogo from "../../assets/crunzzologo.png";
import { getFirebaseServices } from "../../firebase";
import HistoryDateFilter, { getFilterLabel, getFilterHeading } from "../../components/HistoryDateFilter";
import { routeToChooseSelection, usePortalHistoryManager } from "../../navigation/globalNavigationManager";
import { normalizeCrunzzoPackOptions } from "../../utils/crunzzoPacks";
import {
  getCrunzzoRegionId,
  getCrunzzoUserRegion,
  getRegionalRemainingUnits,
} from "../../utils/crunzzoRegions";
import {
  buildNotificationBody,
  createAppNotification,
  isAppNotificationViewed,
  markAppNotificationViewed,
  mergeAppNotifications,
  subscribeToAppNotifications,
  syncComputedAppNotifications,
} from "../../utils/appNotifications";
import "./crunzzo.css";

const { auth, db, storage } = getFirebaseServices("crunzzo");

function formatRupees(value) {
  return `₹${Number(value || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatCompactRupees(value) {
  const amount = Number(value || 0);

  if (amount >= 10000000) return `₹${(amount / 10000000).toFixed(1).replace(".0", "")}Cr`;
  if (amount >= 100000) return `₹${(amount / 100000).toFixed(1).replace(".0", "")}L`;
  if (amount >= 1000) return `₹${(amount / 1000).toFixed(1).replace(".0", "")}K`;

  return `₹${amount.toLocaleString("en-IN")}`;
}

function sanitizePhoneInput(value) {
  return value.replace(/\D/g, "").slice(0, 10);
}

function sanitizeNameInput(value) {
  return value.replace(/[0-9]/g, "");
}

function sanitizePincodeInput(value) {
  return value.replace(/\D/g, "").slice(0, 6);
}

function sanitizeGstInput(value) {
  return value.toUpperCase().replace(/[^0-9A-Z]/g, "").slice(0, 15);
}

function isValidTaxId(value) {
  const val = value.toUpperCase().trim();
  const isGst = /^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z0-9]Z[A-Z0-9]$/.test(val);
  const isPan = /^[A-Z]{5}\d{4}[A-Z]$/.test(val);
  return isGst || isPan;
}

function getAvatarBg(index) {
  const list = [
    "linear-gradient(180deg, #ff8f8f 0%, #e51f28 100%)",
    "linear-gradient(180deg, #ffb3b3 0%, #ef4040 100%)",
    "linear-gradient(180deg, #ff9c9c 0%, #cb232a 100%)",
    "linear-gradient(180deg, #d0a1a1 0%, #a44f4f 100%)",
    "linear-gradient(180deg, #ff7272 0%, #c91922 100%)",
  ];
  return list[index % list.length];
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function buildInvoiceHtml(order) {
  const invoiceNumber = order?.invoiceNumber || `INV-${Date.now()}`;
  const isRetailerOrder = order?.orderType === "retailer_purchase" || Boolean(order?.retailerUid);
  const partnerLabel = isRetailerOrder ? "Retailer" : "Distributor";
  const partnerName = order?.partnerName || order?.retailerName || order?.distributorName || "-";
  const discountLabel = isRetailerOrder ? "Product Offers" : "Wholesale Discount";
  const discountAmount = isRetailerOrder
    ? Number(order?.retailerOfferDiscount || order?.discountTotal || 0)
    : Number(order?.wholesaleDiscount || 0);

  const rows = (order?.items || [])
    .map((item, index) => {
      const qty = Number(item.quantity || 0);
      const rate = Number(item.rate || 0);
      const total = Number.isFinite(Number(item.lineNetTotal))
        ? Number(item.lineNetTotal)
        : qty * rate;

      return `
        <tr>
          <td>${index + 1}</td>
          <td>${escapeHtml(`${item.name || "-"}${item.packLabel ? ` (${item.packLabel})` : ""}`)}</td>
          <td>${qty}${item.totalUnits ? ` packs / ${item.totalUnits} units` : ""}</td>
          <td>${formatRupees(rate)}</td>
          <td>${formatRupees(total)}</td>
        </tr>
      `;
    })
    .join("");

  return `
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>${escapeHtml(invoiceNumber)}</title>
        <style>
          body{
            font-family: Arial, sans-serif;
            background:#f6f7fb;
            margin:0;
            padding:24px;
            color:#1f2a44;
          }
          .sheet{
            max-width:920px;
            margin:0 auto;
            background:#fff;
            border:1px solid #e7ebf2;
            border-radius:18px;
            overflow:hidden;
          }
          .head{
            background:#e51f28;
            color:#fff;
            padding:24px;
          }
          .head h1{
            margin:0;
            font-size:28px;
          }
          .head p{
            margin:8px 0 0;
            font-size:14px;
          }
          .section{
            padding:24px;
            border-top:1px solid #e7ebf2;
          }
          .grid{
            display:grid;
            grid-template-columns:1fr 1fr;
            gap:18px;
          }
          .label{
            font-size:12px;
            color:#7d879b;
            text-transform:uppercase;
            letter-spacing:.04em;
            margin-bottom:6px;
          }
          .value{
            font-size:15px;
            font-weight:700;
          }
          table{
            width:100%;
            border-collapse:collapse;
            margin-top:12px;
          }
          th, td{
            border:1px solid #e7ebf2;
            padding:10px 12px;
            text-align:left;
            font-size:14px;
          }
          th{
            background:#f8fafc;
          }
          .totals{
            width:320px;
            margin-left:auto;
            margin-top:18px;
          }
          .row{
            display:flex;
            justify-content:space-between;
            padding:10px 0;
            border-bottom:1px solid #e7ebf2;
          }
          .grand{
            color:#e51f28;
            font-size:18px;
            font-weight:800;
          }
        </style>
      </head>
      <body>
        <div class="sheet">
          <div class="head">
            <h1>Crunzzo Invoice</h1>
            <p>${escapeHtml(invoiceNumber)}</p>
          </div>

          <div class="section">
            <div class="grid">
              <div>
                <div class="label">Shop Name</div>
                <div class="value">${escapeHtml(order?.shopName || "-")}</div>
              </div>
              <div>
                <div class="label">Contact Phone</div>
                <div class="value">${escapeHtml(order?.phone || "-")}</div>
              </div>
              <div>
                <div class="label">GST/PAN Number</div>
                <div class="value">${escapeHtml(order?.gst || "-")}</div>
              </div>
              <div>
                <div class="label">Sales Pincode</div>
                <div class="value">${escapeHtml(order?.salesPincode || order?.pincode || order?.salesZone || "-")}</div>
              </div>
              <div>
                <div class="label">${partnerLabel}</div>
                <div class="value">${escapeHtml(partnerName)}</div>
              </div>
              <div>
                <div class="label">Created At</div>
                <div class="value">${escapeHtml(
    new Date(order?.createdAtMs || Date.now()).toLocaleString("en-IN")
  )}</div>
              </div>
            </div>
          </div>

          <div class="section">
            <div class="label">Order Details</div>
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Product</th>
                  <th>Qty</th>
                  <th>Rate</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>

            <div class="totals">
              <div class="row">
                <span>Subtotal</span>
                <span>${formatRupees(order?.subtotal || 0)}</span>
              </div>
              <div class="row">
                <span>${discountLabel}</span>
                <span>- ${formatRupees(discountAmount)}</span>
              </div>
              <div class="row">
                <span>Tax</span>
                <span>${formatRupees(order?.tax || 0)}</span>
              </div>
              <div class="row grand">
                <span>Total</span>
                <span>${formatRupees(order?.total || 0)}</span>
              </div>
            </div>
          </div>
        </div>
      </body>
    </html>
  `;
}

function downloadInvoiceFile(order) {
  if (!order) {
    alert("Invoice data not found.");
    return;
  }

  try {
    const invoiceNumber = order.invoiceNumber || `INV-${Date.now()}`;
    const html = buildInvoiceHtml(order);
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);

    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${invoiceNumber}.html`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);

    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) {
    console.error("Invoice download failed:", error);
    alert("Invoice download failed.");
  }
}

const NAV_IDLE = "#8491a7";
const NAV_ACTIVE = "#e51f28";
const BRAND_ACCENT = "#e51f28";
const BRAND_GRAD_FROM = "#ff5b5b";
const BRAND_GRAD_TO = "#d81b25";
const DISTRIBUTOR_VIEWED_NOTIFICATIONS_KEY = "crunzzo_distributor_viewed_notifications_v1";

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
    // Notification read state is local UI state and should never block orders.
  }
}

function getDashboardMode(accountType) {
  return accountType === "retailer" ? "retailer" : "distributor";
}

function getRetailerOfferPercent(product) {
  const raw = Number(product?.retailerOfferPercent ?? product?.offerPercent ?? 0);
  if (!Number.isFinite(raw)) return 0;
  return Math.min(100, Math.max(0, raw));
}

function isRetailerOrder(order) {
  return order?.orderType === "retailer_purchase" || Boolean(order?.retailerUid);
}

function getOrderPartnerName(order) {
  return (
    order?.partnerName ||
    order?.retailerName ||
    order?.distributorName ||
    order?.shopName ||
    "Partner"
  );
}

function getOrderUnits(order) {
  const directUnits = Number(order?.totalUnits || 0);
  if (directUnits > 0) return directUnits;

  return (order?.items || []).reduce((sum, item) => {
    return sum + Number(item.totalUnits || 0);
  }, 0);
}

function getOrderItemsSummary(order) {
  const items = Array.isArray(order?.items) ? order.items : [];
  if (!items.length) return "No item details saved";

  return items
    .map((item) => {
      const quantity = Number(item.quantity || 1);
      const units = Number(item.totalUnits || 0);
      return `${item.name || "Item"} x ${quantity} (${units} units)`;
    })
    .join(", ");
}

function formatNotificationTime(value) {
  if (!value) return "-";
  try {
    return new Date(value).toLocaleString("en-IN", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "-";
  }
}

function ThemeOverrides() {
  return (
    <style>{`
      [data-brand="crunzzo"] .bzd-primary-btn,
      [data-brand="crunzzo"] .bzd-review-btn {
        background: linear-gradient(180deg, ${BRAND_GRAD_FROM} 0%, ${BRAND_GRAD_TO} 100%) !important;
        box-shadow: 0 10px 20px rgba(229,31,40,0.18) !important;
      }

      [data-brand="crunzzo"] .bzd-secondary-btn {
        border-color: ${BRAND_ACCENT} !important;
        color: ${BRAND_ACCENT} !important;
      }

      [data-brand="crunzzo"] .bzd-filter-row button.active,
      [data-brand="crunzzo"] .bzd-total-card,
      [data-brand="crunzzo"] .bzd-history-hero,
      [data-brand="crunzzo"] .bzd-sales-card,
      [data-brand="crunzzo"] .czd-qty-row button,
      [data-brand="crunzzo"] .bzd-qty-row button,
      [data-brand="crunzzo"] .czd-review-total,
      [data-brand="crunzzo"] .bzd-review-total {
        background: linear-gradient(180deg, ${BRAND_GRAD_FROM} 0%, ${BRAND_GRAD_TO} 100%) !important;
        color: #fff !important;
      }

      [data-brand="crunzzo"] .bzd-sales-card h2,
      [data-brand="crunzzo"] .bzd-sales-card small,
      [data-brand="crunzzo"] .bzd-sales-card strong {
        color: #fff !important;
      }

      [data-brand="crunzzo"] .bzd-add-btn,
      [data-brand="crunzzo"] .czd-add-btn {
        background: ${BRAND_ACCENT} !important;
      }
      [data-brand="crunzzo"] .bzd-add-btn:disabled,
      [data-brand="crunzzo"] .czd-add-btn:disabled {
        background: ${BRAND_ACCENT}18 !important;
        color: ${BRAND_ACCENT} !important;
        border: 1.5px solid ${BRAND_ACCENT}40 !important;
      }

      [data-brand="crunzzo"] .bzd-bottom-nav button.active span,
      [data-brand="crunzzo"] .czd-bottom-nav button.active span {
        color: ${BRAND_ACCENT} !important;
      }

      [data-brand="crunzzo"] .bzd-bottom-nav button.active,
      [data-brand="crunzzo"] .czd-bottom-nav button.active {
        color: ${BRAND_ACCENT} !important;
        background: ${BRAND_ACCENT}18 !important;
      }

      [data-brand="crunzzo"] .bzd-bottom-nav button.active svg path,
      [data-brand="crunzzo"] .bzd-bottom-nav button.active svg circle,
      [data-brand="crunzzo"] .czd-bottom-nav button.active svg path,
      [data-brand="crunzzo"] .czd-bottom-nav button.active svg circle {
        stroke: ${BRAND_ACCENT} !important;
      }

      [data-brand="crunzzo"] .bzd-history-search input:focus,
      [data-brand="crunzzo"] .bzd-search-wrap input:focus,
      [data-brand="crunzzo"] .bzd-form-list input:focus,
      [data-brand="crunzzo"] .bzd-form-list select:focus {
        border-color: ${BRAND_ACCENT} !important;
        box-shadow: 0 0 0 3px rgba(229,31,40,0.08) !important;
      }

      [data-brand="crunzzo"] .bzd-success-actions .receipt {
        background: #fdeeee !important;
        color: ${BRAND_ACCENT} !important;
      }

      [data-brand="crunzzo"] .bzd-progress-row span {
        background: #f4c8c8 !important;
      }

      [data-brand="crunzzo"] .bzd-progress-row span.active {
        background: ${BRAND_ACCENT} !important;
      }

      [data-brand="crunzzo"] .bzd-summary-copy small {
        color: ${BRAND_ACCENT} !important;
      }

      [data-brand="crunzzo"] .bzd-summary-fallback {
        background: linear-gradient(180deg, #ffe3d7 0%, #ffd1b4 100%) !important;
        color: #9f3d00 !important;
      }

      [data-brand="crunzzo"] .bzd-success-wrap h1 {
        color: ${BRAND_ACCENT} !important;
      }

      [data-brand="crunzzo"] .bzd-section-head button {
        color: ${BRAND_ACCENT} !important;
      }

      [data-brand="crunzzo"] .bzd-success-icon {
        box-shadow: 0 10px 22px rgba(24,163,74,0.18) !important;
      }
    `}</style>
  );
}

function DashboardNavIcon({ type, active }) {
  const color = active ? NAV_ACTIVE : NAV_IDLE;
  const strokeWidth = 2.1;

  if (type === "home") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z"
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  if (type === "products") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M4 7h16v13H4z"
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinejoin="round"
        />
        <path
          d="M8 3h8v4H8z"
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  if (type === "history") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M4 12a8 8 0 1 0 2.3-5.7"
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
        />
        <path
          d="M4 5v4h4"
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M12 8v4l3 2"
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  if (type === "profile") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="8" r="3.2" fill="none" stroke={color} strokeWidth={strokeWidth} />
        <path
          d="M5 20c1.4-3.3 4.2-5 7-5s5.6 1.7 7 5"
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
        />
      </svg>
    );
  }

  return null;
}

function ProfileMenuRow({ icon, title, subtitle, onClick, accent }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        width: "100%",
        background: "#fff",
        border: "1px solid #ececec",
        borderRadius: 16,
        padding: "14px",
        display: "flex",
        alignItems: "center",
        gap: 12,
        cursor: "pointer",
        textAlign: "left",
      }}
    >
      <div
        style={{
          width: 34,
          height: 34,
          borderRadius: 10,
          display: "grid",
          placeItems: "center",
          background: "#f7f8fb",
          color: accent,
          fontSize: 16,
          flexShrink: 0,
        }}
      >
        {icon}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#20263a" }}>{title}</div>
        <div style={{ fontSize: 11, color: "#7d879b", marginTop: 2 }}>{subtitle}</div>
      </div>

      <div style={{ color: "#9aa3b2", fontSize: 16 }}>›</div>
    </button>
  );
}

export default function CrunzzoDistributorDashboard({ accountType = "distributor" } = {}) {
  const navigate = useNavigate();
  const fileInputRef = useRef(null);
  const dashboardMode = getDashboardMode(accountType);
  const isRetailer = dashboardMode === "retailer";
  const roleLabel = isRetailer ? "Retailer" : "Distributor";
  const roleFallbackName = isRetailer ? "Retailer" : "Distributor";
  const rolePath = isRetailer ? "/crunzzo/retailer" : "/crunzzo/distributor";
  const transactionLabel = isRetailer ? "Purchase" : "Sale";
  const transactionVerb = isRetailer ? "purchase" : "sell";
  const transactionNoun = isRetailer ? "purchase" : "sale";

  const [screen, setScreen] = useState("home");
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [userProfile, setUserProfile] = useState(null);

  const [loadingProfile, setLoadingProfile] = useState(true);
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [loadingRegionalInventory, setLoadingRegionalInventory] = useState(true);
  const [regionalInventoryErrors, setRegionalInventoryErrors] = useState({});
  const [loadingOrders, setLoadingOrders] = useState(true);
  const [submittingOrder, setSubmittingOrder] = useState(false);

  const [products, setProducts] = useState([]);
  const [regionalInventory, setRegionalInventory] = useState({});
  const [orders, setOrders] = useState([]);
  const [regionalNotificationOrders, setRegionalNotificationOrders] = useState([]);
  const [notificationError, setNotificationError] = useState("");
  const [viewedNotifications, setViewedNotifications] = useState(() =>
    readStoredIdMap(DISTRIBUTOR_VIEWED_NOTIFICATIONS_KEY)
  );
  const [remoteDistributorNotifications, setRemoteDistributorNotifications] = useState([]);
  const [selectedNotification, setSelectedNotification] = useState(null);
  const [lastOrder, setLastOrder] = useState(null);

  const [customer, setCustomer] = useState({
    shopName: "",
    phone: "",
    gst: "",
    pincode: "",
  });

  const [customerError, setCustomerError] = useState("");
  const [search, setSearch] = useState("");
  const [historySearch, setHistorySearch] = useState("");
  const [historyFilter, setHistoryFilter] = useState("today");
  const [startDate, setStartDate] = useState(null);
  const [endDate, setEndDate] = useState(null);
  const [category, setCategory] = useState("all");
  const [cart, setCart] = useState({});
  const [selectedProductForPacks, setSelectedProductForPacks] = useState(null);
  const [pendingSummaryAfterCustomer, setPendingSummaryAfterCustomer] = useState(false);

  const [profileOpen, setProfileOpen] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMessage, setProfileMessage] = useState("");
  const [profileImageFile, setProfileImageFile] = useState(null);
  const [profilePreview, setProfilePreview] = useState("");
  const [profileForm, setProfileForm] = useState({
    name: "",
    businessName: "",
    phone: "",
    territory: "",
  });

  const goToScreen = usePortalHistoryManager({
    portalKey: `crunzzo-${dashboardMode}`,
    basePath: rolePath,
    rootScreen: "home",
    currentScreen: screen,
    setScreen,
  });

  useEffect(() => {
    setShowLogoutConfirm(false);
  }, [screen]);

  useEffect(() => {
    let unsubscribeOrders = () => { };
    let unsubscribeRegionalNotifications = () => { };

    const unsubscribeAuth = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        setUserProfile(null);
        setOrders([]);
        setRegionalNotificationOrders([]);
        setNotificationError("");
        setLoadingProfile(false);
        setLoadingRegionalInventory(false);
        setLoadingOrders(false);
        routeToChooseSelection(navigate);
        return;
      }

      try {
        const userSnap = await getDoc(doc(db, "users", user.uid));
        const profileData = userSnap.exists() ? userSnap.data() : {};

        const merged = {
          uid: user.uid,
          email: user.email || "",
          ...profileData,
        };

        if (merged.role === "super_stockist") {
          setLoadingProfile(false);
          setLoadingRegionalInventory(false);
          setLoadingOrders(false);
          navigate("/crunzzo/super-stockist", { replace: true });
          return;
        }

        if (merged.role === "admin") {
          setLoadingProfile(false);
          setLoadingRegionalInventory(false);
          setLoadingOrders(false);
          navigate("/crunzzo/admin", { replace: true });
          return;
        }

        if (merged.role === "retailer" && !isRetailer) {
          setLoadingProfile(false);
          setLoadingRegionalInventory(false);
          setLoadingOrders(false);
          navigate("/crunzzo/retailer", { replace: true });
          return;
        }

        if (merged.role !== "retailer" && isRetailer) {
          setLoadingProfile(false);
          setLoadingRegionalInventory(false);
          setLoadingOrders(false);
          navigate("/crunzzo/distributor", { replace: true });
          return;
        }

        const region = getCrunzzoUserRegion(merged);
        const regionId = getCrunzzoRegionId(region);
        const regionalProfile = { ...merged, region };

        setUserProfile(regionalProfile);
        setProfileForm({
          name: regionalProfile.name || "",
          businessName: regionalProfile.businessName || "",
          phone: regionalProfile.phone || "",
          territory: regionalProfile.territory || regionalProfile.zone || "North Region",
        });
        setProfilePreview(regionalProfile.profileImageUrl || "");

        if (!regionId) {
          setRegionalInventory({});
          setLoadingRegionalInventory(false);
        }

        unsubscribeOrders = onSnapshot(
          query(collection(db, "orders"), where(isRetailer ? "retailerUid" : "distributorUid", "==", user.uid)),
          (snapshot) => {
            const rows = snapshot.docs
              .map((docSnap) => ({
                id: docSnap.id,
                ...docSnap.data(),
              }))
              .sort((a, b) => Number(b.createdAtMs || 0) - Number(a.createdAtMs || 0));

            setOrders(rows);
            setLoadingOrders(false);
          },
          (error) => {
            console.error("Orders fetch error:", error);
            setLoadingOrders(false);
          }
        );

        if (!isRetailer && region) {
          unsubscribeRegionalNotifications = onSnapshot(
            query(collection(db, "orders"), where("region", "==", region)),
            (snapshot) => {
              const rows = snapshot.docs
                .map((docSnap) => ({
                  id: docSnap.id,
                  ...docSnap.data(),
                }))
                .filter(isRetailerOrder)
                .sort((a, b) => Number(b.createdAtMs || 0) - Number(a.createdAtMs || 0));

              setRegionalNotificationOrders(rows);
              setNotificationError("");
            },
            (error) => {
              console.warn("Regional notification fetch error:", error);
              setRegionalNotificationOrders([]);
              setNotificationError("Regional retailer notifications need Firestore read access for same-region orders.");
            }
          );
        } else {
          setRegionalNotificationOrders([]);
          setNotificationError("");
        }

      } catch (error) {
        console.error("Profile fetch error:", error);
        setLoadingProfile(false);
        setLoadingRegionalInventory(false);
        setLoadingOrders(false);
      } finally {
        setLoadingProfile(false);
      }
    });

    const unsubscribeProducts = onSnapshot(
      collection(db, "products"),
      (snapshot) => {
        const rows = snapshot.docs
          .map((docSnap) => ({
            id: docSnap.id,
            ...docSnap.data(),
          }))
          .filter((item) => item.status !== "inactive")
          .sort((a, b) => Number(b.createdAtMs || 0) - Number(a.createdAtMs || 0));

        setProducts(rows);
        setLoadingProducts(false);
      },
      (error) => {
        console.error("Products fetch error:", error);
        setLoadingProducts(false);
      }
    );

    return () => {
      unsubscribeAuth();
      unsubscribeOrders();
      unsubscribeRegionalNotifications();
      unsubscribeProducts();
    };
  }, [isRetailer, navigate]);

  useEffect(() => {
    const role = userProfile?.role || dashboardMode;
    const regionId = getCrunzzoRegionId(userProfile?.region);
    if (!userProfile?.uid || !role) {
      setRemoteDistributorNotifications([]);
      return undefined;
    }

    return subscribeToAppNotifications({
      db,
      section: "crunzzo",
      role,
      uid: userProfile.uid,
      regionId,
      onChange: setRemoteDistributorNotifications,
    });
  }, [dashboardMode, userProfile?.region, userProfile?.role, userProfile?.uid]);

  useEffect(() => {
    const regionId = getCrunzzoRegionId(userProfile?.region);
    if (!userProfile?.uid || !regionId) return undefined;
    if (!products.length) {
      if (!loadingProducts) {
        setRegionalInventory({});
        setRegionalInventoryErrors({});
        setLoadingRegionalInventory(false);
      }
      return undefined;
    }

    let active = true;
    const pendingProductIds = new Set(products.map((product) => product.id));
    const nextErrors = {};

    setLoadingRegionalInventory(true);
    setRegionalInventory({});
    setRegionalInventoryErrors({});

    const finishProduct = (productId) => {
      pendingProductIds.delete(productId);
      if (!active || pendingProductIds.size) return;
      setRegionalInventoryErrors(nextErrors);
      setLoadingRegionalInventory(false);
    };

    const unsubscribers = products.map((product) =>
      onSnapshot(
        doc(db, "regional_inventory", regionId, "products", product.id),
        (snapshot) => {
          if (!active) return;

          setRegionalInventory((previous) => {
            const next = { ...previous };
            if (snapshot.exists()) {
              next[product.id] = { id: snapshot.id, ...snapshot.data() };
            } else {
              delete next[product.id];
            }
            return next;
          });
          delete nextErrors[product.id];
          finishProduct(product.id);
        },
        (error) => {
          if (!active) return;
          nextErrors[product.id] = error.code || "regional-stock-unavailable";
          finishProduct(product.id);
        }
      )
    );

    return () => {
      active = false;
      unsubscribers.forEach((unsubscribe) => unsubscribe());
    };
  }, [loadingProducts, products, userProfile?.region, userProfile?.uid]);

  const categoryTabs = useMemo(() => {
    const names = [...new Set(products.map((item) => (item.category || "").trim()).filter(Boolean))];
    return ["all", ...names];
  }, [products]);

  const filteredProducts = useMemo(() => {
    return products.filter((product) => {
      const categoryMatch =
        category === "all" || (product.category || "").toLowerCase() === category.toLowerCase();

      const searchMatch =
        !search.trim() ||
        (product.name || "").toLowerCase().includes(search.toLowerCase());

      return categoryMatch && searchMatch;
    });
  }, [products, category, search]);

  const selectedProductForPacksLive = useMemo(() => {
    if (!selectedProductForPacks) return null;
    return (
      products.find((product) => product.id === selectedProductForPacks.id) ||
      selectedProductForPacks
    );
  }, [products, selectedProductForPacks]);

  const selectedItems = useMemo(() => {
    return products.flatMap((product) => {
      return normalizeCrunzzoPackOptions(product)
        .filter((pack) => cart[`${product.id}_${pack.id}`] > 0)
        .map((pack) => {
          const quantity = cart[`${product.id}_${pack.id}`];
          const rate = Number(pack.rate || 0);
          const lineTotal = quantity * rate;
          const offerPercent = isRetailer ? getRetailerOfferPercent(product) : 0;
          const lineDiscount = lineTotal * (offerPercent / 100);
          const lineNetTotal = lineTotal - lineDiscount;

          return {
            ...product,
            id: `${product.id}_${pack.id}`,
            productId: product.id,
            packId: pack.id,
            packLabel: pack.label,
            packSize: pack.packSize,
            quantity,
            totalUnits: quantity * pack.packSize,
            gst: Number(pack.gst || 0),
            unitLabel: pack.label,
            rate,
            offerPercent,
            lineDiscount,
            lineNetTotal,
            linePayable: lineNetTotal,
            lineTotal,
            rateLabel: offerPercent
              ? `${formatRupees(rate)} / ${pack.label} - ${offerPercent}% offer`
              : `${formatRupees(rate)} / ${pack.label}`,
          };
        });
    });
  }, [products, cart, isRetailer]);

  const totalUnits = selectedItems.reduce((sum, item) => sum + item.totalUnits, 0);
  const subtotal = selectedItems.reduce((sum, item) => sum + item.lineTotal, 0);
  const retailerOfferDiscount = isRetailer
    ? selectedItems.reduce((sum, item) => sum + Number(item.lineDiscount || 0), 0)
    : 0;
  const wholesaleDiscount = isRetailer ? 0 : subtotal * 0.05;
  const taxableValue = Math.max(0, subtotal - wholesaleDiscount - retailerOfferDiscount);
  const weightedGstRate = subtotal
    ? selectedItems.reduce((sum, item) => sum + item.lineTotal * Number(item.gst || 0), 0) / subtotal
    : 0;
  const tax = isRetailer
    ? selectedItems.reduce((sum, item) => sum + Number(item.lineNetTotal || 0) * (Number(item.gst || 0) / 100), 0)
    : taxableValue * (weightedGstRate / 100);
  const totalSaleValue = taxableValue + tax;
  const cartPreviewTotal = subtotal - retailerOfferDiscount;

  const { todayRevenue, todayUnits } = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    const todayOrders = orders.filter((o) => Number(o.createdAtMs || 0) >= d.getTime());
    return {
      todayRevenue: todayOrders.reduce((sum, item) => sum + Number(item.total || 0), 0),
      todayUnits: todayOrders.reduce((sum, item) => sum + Number(item.totalUnits || 0), 0),
    };
  }, [orders]);

  const filteredOrders = useMemo(() => {
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

      const s = historySearch.toLowerCase().trim();
      const searchMatch =
        !s ||
        (order.shopName || "").toLowerCase().includes(s) ||
        (order.id || "").toLowerCase().includes(s);

      return timeMatch && searchMatch;
    });
  }, [orders, historyFilter, historySearch, startDate, endDate]);

  const historyTotal = useMemo(() => {
    return filteredOrders.reduce((sum, item) => sum + Number(item.total || 0), 0);
  }, [filteredOrders]);

  const recentActivity = orders.slice(0, 3);
  const computedDistributorNotifications = useMemo(() => {
    if (isRetailer) return [];
    const regionId = getCrunzzoRegionId(userProfile?.region);

    return regionalNotificationOrders.slice(0, 30).map((order) => {
      const partnerName = getOrderPartnerName(order);
      const totalUnits = getOrderUnits(order);
      const itemSummary = getOrderItemsSummary(order);
      const id = `retailer-order-${order.id}`;
      const message = `${partnerName} • ${order.region || userProfile?.region || "No region"} • ${formatRupees(order.total || 0)}`;
      const detail = buildNotificationBody([
        `Retailer: ${partnerName}`,
        `Region: ${order.region || userProfile?.region || "No region"}`,
        `Total: ${formatRupees(order.total || 0)}`,
        `Units: ${totalUnits}`,
        `Items: ${itemSummary}`,
        order.invoiceNumber ? `Invoice: ${order.invoiceNumber}` : "",
      ]);

      return {
        id,
        sourceId: id,
        tone: "#b45309",
        section: "crunzzo",
        type: "regional_retailer_purchase",
        severity: "info",
        title: "Retailer purchase in your region",
        body: message,
        message,
        detail,
        targetRoles: ["distributor"],
        regionId,
        entityType: "order",
        entityId: order.id,
        targetPath: "/crunzzo/distributor/notifications",
        targetTab: "notifications",
        data: { detail, sourceId: id },
        dedupeKey: `crunzzo:distributor:regional_retailer_purchase:${order.id}`,
        pushEnabled: true,
        time: formatNotificationTime(order.createdAtMs),
        createdAtMs: Number(order.createdAtMs || 0),
      };
    });
  }, [isRetailer, regionalNotificationOrders, userProfile?.region]);

  useEffect(() => {
    if (isRetailer || userProfile?.role !== "distributor") return;
    syncComputedAppNotifications(db, computedDistributorNotifications);
  }, [computedDistributorNotifications, isRetailer, userProfile?.role]);

  const distributorNotifications = useMemo(
    () =>
      mergeAppNotifications(remoteDistributorNotifications, computedDistributorNotifications).slice(0, 30),
    [computedDistributorNotifications, remoteDistributorNotifications]
  );

  const unreadDistributorNotificationCount = distributorNotifications.filter(
    (item) => !isAppNotificationViewed(item, userProfile?.uid, viewedNotifications)
  ).length;
  const prioritizedDistributorNotifications = useMemo(() => {
    const unread = [];
    const viewed = [];
    distributorNotifications.forEach((item) => {
      if (isAppNotificationViewed(item, userProfile?.uid, viewedNotifications)) viewed.push(item);
      else unread.push(item);
    });
    return [...unread, ...viewed];
  }, [distributorNotifications, userProfile?.uid, viewedNotifications]);

  const openDistributorNotification = (item) => {
    setSelectedNotification(item);
    markAppNotificationViewed(db, item, userProfile?.uid).catch((error) => {
      console.warn("Failed to mark distributor notification read:", error);
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
      saveStoredIdMap(DISTRIBUTOR_VIEWED_NOTIFICATIONS_KEY, next);
      return next;
    });
  };

  const validateCustomerInputs = () => {
    if (!customer.shopName.trim()) {
      setCustomerError("Please enter shop name.");
      return false;
    }

    if (!/^\d{10}$/.test(customer.phone.trim())) {
      setCustomerError("Phone number must be exactly 10 digits.");
      return false;
    }

    if (!customer.gst.trim()) {
      setCustomerError("Please enter GST or PAN number.");
      return false;
    }

    if (!isValidTaxId(customer.gst.trim())) {
      setCustomerError("Please enter a valid 15-character GST or 10-character PAN number.");
      return false;
    }

    if (!/^\d{6}$/.test(customer.pincode.trim())) {
      setCustomerError("Pincode must be exactly 6 digits.");
      return false;
    }

    setCustomerError("");
    return true;
  };

  const handleCustomerChange = (e) => {
    const { name, value } = e.target;
    let finalValue = value;

    if (name === "phone") finalValue = sanitizePhoneInput(value);
    if (name === "pincode") finalValue = sanitizePincodeInput(value);
    if (name === "gst") finalValue = sanitizeGstInput(value);

    setCustomerError("");
    setCustomer((prev) => ({
      ...prev,
      [name]: finalValue,
    }));
  };

  const handleProfileInputChange = (e) => {
    const { name, value } = e.target;
    let finalValue = value;

    if (name === "phone") {
      finalValue = sanitizePhoneInput(value);
    } else if (name === "name" || name === "businessName") {
      finalValue = sanitizeNameInput(value);
    }

    setProfileMessage("");
    setProfileForm((prev) => ({
      ...prev,
      [name]: finalValue,
    }));
  };

  const handleProfileImagePick = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setProfileImageFile(file);
    const localUrl = URL.createObjectURL(file);
    setProfilePreview(localUrl);
    setProfileMessage("");
  };

  const handleSaveProfile = async () => {
    if (!userProfile?.uid) return;

    if (!profileForm.name.trim()) {
      setProfileMessage("Please enter full name.");
      return;
    }

    if (!/^\d{10}$/.test(profileForm.phone.trim())) {
      setProfileMessage("Phone number must be exactly 10 digits.");
      return;
    }

    try {
      setProfileSaving(true);
      setProfileMessage("");

      let profileImageUrl = userProfile?.profileImageUrl || "";

      if (profileImageFile) {
        const extension = profileImageFile.name.split(".").pop() || "jpg";
        const imageRef = ref(
          storage,
          `profiles/${userProfile.uid}/avatar-${Date.now()}.${extension}`
        );
        await uploadBytes(imageRef, profileImageFile);
        profileImageUrl = await getDownloadURL(imageRef);
      }

      const payload = {
        name: profileForm.name.trim(),
        businessName: profileForm.businessName.trim(),
        phone: profileForm.phone.trim(),
        territory: profileForm.territory.trim(),
        profileImageUrl,
      };

      await updateDoc(doc(db, "users", userProfile.uid), payload);

      setUserProfile((prev) => ({
        ...prev,
        ...payload,
      }));

      setProfilePreview(profileImageUrl);
      setProfileImageFile(null);
      setProfileOpen(false);
      setProfileMessage("Profile updated successfully.");
    } catch (error) {
      console.error("Profile update error:", error);
      setProfileMessage("Failed to update profile.");
    } finally {
      setProfileSaving(false);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setShowLogoutConfirm(false);
      routeToChooseSelection(navigate);
    } catch (error) {
      console.error("Logout error:", error);
      setProfileMessage("Failed to logout.");
    }
  };

  const getRegionalStockState = (productId) => {
    const allocation = regionalInventory[productId];
    if (allocation) {
      return {
        availableUnits: getRegionalRemainingUnits(allocation),
        isAvailable: true,
      };
    }

    const product = products.find((item) => item.id === productId);
    const regionId = getCrunzzoRegionId(userProfile?.region);
    const projectedStock = product?.regionalStock?.[regionId];
    if (projectedStock !== undefined && Number.isFinite(Number(projectedStock))) {
      return {
        availableUnits: Math.max(0, Number(projectedStock)),
        isAvailable: true,
      };
    }

    return {
      availableUnits: 0,
      isAvailable: !regionalInventoryErrors[productId],
    };
  };

  const getRegionalAvailableUnits = (productId) =>
    getRegionalStockState(productId).availableUnits;

  const regionalStockUnavailable = Boolean(
    products.some((product) => !getRegionalStockState(product.id).isAvailable)
  );

  const addToCart = (productId, packId) => {
    const product = products.find((p) => p.id === productId);
    const pack = normalizeCrunzzoPackOptions(product).find((item) => item.id === packId);
    if (!pack) return;

    const cartKey = `${productId}_${packId}`;
    const currentQty = cart[cartKey] || 0;
    const availableUnits = getRegionalAvailableUnits(productId);
    const selectedUnitsForProduct = selectedItems
      .filter((item) => item.productId === productId)
      .reduce((sum, item) => sum + Number(item.totalUnits || 0), 0);

    if (selectedUnitsForProduct + Number(pack.packSize || 0) > availableUnits) {
      return;
    }

    setCart((prev) => ({
      ...prev,
      [cartKey]: currentQty + 1,
    }));
  };

  const removeFromCart = (productId, packId) => {
    const cartKey = `${productId}_${packId}`;

    setCart((prev) => {
      const next = { ...prev };
      const current = next[cartKey] || 0;

      if (current <= 1) {
        delete next[cartKey];
      } else {
        next[cartKey] = current - 1;
      }

      return next;
    });
  };

  const resetSaleFlow = () => {
    setCustomer({
      shopName: "",
      phone: "",
      gst: "",
      pincode: "",
    });
    setCustomerError("");
    setCategory("all");
    setSearch("");
    setCart({});
    setSelectedProductForPacks(null);
    setLastOrder(null);
    setPendingSummaryAfterCustomer(false);
  };

  const startNewSale = () => {
    resetSaleFlow();
    goToScreen("customer");
  };

  const moveToProducts = () => {
    if (!validateCustomerInputs()) return;

    if (pendingSummaryAfterCustomer) {
      setPendingSummaryAfterCustomer(false);
      goToScreen("summary");
      return;
    }

    goToScreen("products");
  };

  const moveToSummary = () => {
    if (!selectedItems.length) return;

    if (!validateCustomerInputs()) {
      setPendingSummaryAfterCustomer(true);
      goToScreen("customer");
      return;
    }

    goToScreen("summary");
  };

  const buildCurrentInvoiceData = () => ({
    invoiceNumber: `INV-PREVIEW-${Date.now()}`,
    orderType: isRetailer ? "retailer_purchase" : "distributor_sale",
    accountRole: dashboardMode,
    partnerRole: dashboardMode,
    partnerUid: userProfile?.uid || "",
    partnerName: userProfile?.name || auth.currentUser?.displayName || roleFallbackName,
    partnerId: userProfile?.partnerId || userProfile?.retailerId || userProfile?.distributorId || "",
    ...(isRetailer
      ? {
          retailerUid: userProfile?.uid || "",
          retailerName: userProfile?.name || auth.currentUser?.displayName || "Retailer",
          retailerId: userProfile?.retailerId || userProfile?.partnerId || "",
        }
      : {
          distributorUid: userProfile?.uid || "",
          distributorName: userProfile?.name || auth.currentUser?.displayName || "Distributor",
          distributorId: userProfile?.distributorId || userProfile?.partnerId || "",
        }),
    shopName: customer.shopName,
    phone: customer.phone,
    gst: customer.gst,
    salesPincode: customer.pincode,
    pincode: customer.pincode,
    subtotal,
    wholesaleDiscount,
    retailerOfferDiscount,
    discountTotal: wholesaleDiscount + retailerOfferDiscount,
    tax,
    total: totalSaleValue,
    totalUnits,
    itemCount: selectedItems.length,
    items: selectedItems.map((item) => ({
      productId: item.productId,
      packId: item.packId,
      packLabel: item.packLabel,
      packSize: item.packSize,
      totalUnits: item.totalUnits,
      name: item.name || "",
      category: item.category || "",
      quantity: item.quantity,
      unitLabel: item.unitLabel || "",
      rate: Number(item.rate || 0),
      gst: Number(item.gst || 0),
      offerPercent: Number(item.offerPercent || 0),
      lineDiscount: Number(item.lineDiscount || 0),
      lineNetTotal: Number(item.lineNetTotal || item.lineTotal || 0),
      lineTotal: item.lineTotal,
      imageUrl: item.imageUrl || "",
    })),
    createdAtMs: Date.now(),
    timeLabel: new Date().toLocaleString("en-IN", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }),
  });

  const sendOrderNotifications = async (orderId, orderPayload, regionId) => {
    const partnerName = getOrderPartnerName(orderPayload);
    const itemSummary = getOrderItemsSummary(orderPayload);
    const totalLabel = formatRupees(orderPayload.total || 0);
    const detail = buildNotificationBody([
      `Partner: ${partnerName}`,
      `Region: ${orderPayload.region || userProfile?.region || "No region"}`,
      `Total: ${totalLabel}`,
      `Units: ${orderPayload.totalUnits || 0}`,
      `Items: ${itemSummary}`,
      orderPayload.invoiceNumber ? `Invoice: ${orderPayload.invoiceNumber}` : "",
    ]);
    const orderType = isRetailer ? "regional_retailer_purchase" : "regional_distributor_sale";
    const regionalTitle = isRetailer
      ? "Retailer purchase in your region"
      : "Distributor sale in your region";
    const regionalBody = `${partnerName} • ${totalLabel}`;
    const base = {
      section: "crunzzo",
      severity: "info",
      entityType: "order",
      entityId: orderId,
      createdAtMs: orderPayload.createdAtMs,
      pushEnabled: true,
    };

    const notifications = [
      {
        ...base,
        type: "recent_order",
        title: isRetailer ? "Retailer purchase recorded" : "Distributor sale recorded",
        body: `${partnerName} • ${orderPayload.region || "No region"} • ${totalLabel}`,
        targetRoles: ["admin"],
        targetPath: "/crunzzo/admin/notifications",
        targetTab: "notifications",
        data: { detail, sourceId: `order-${orderId}` },
        sourceId: `order-${orderId}`,
        detail,
        dedupeKey: `crunzzo:admin:recent_order:${orderId}`,
      },
      {
        ...base,
        type: orderType,
        title: regionalTitle,
        body: regionalBody,
        targetRoles: ["super_stockist"],
        regionId,
        targetPath: "/crunzzo/super-stockist/notifications",
        targetTab: "notifications",
        data: { detail, sourceId: `order-${orderId}` },
        sourceId: `order-${orderId}`,
        detail,
        dedupeKey: `crunzzo:super_stockist:${orderType}:${orderId}`,
      },
    ];

    if (isRetailer) {
      const distributorDetail = detail.replace(/^Partner:/, "Retailer:");
      notifications.push({
        ...base,
        type: "regional_retailer_purchase",
        title: "Retailer purchase in your region",
        body: `${partnerName} • ${orderPayload.region || "No region"} • ${totalLabel}`,
        targetRoles: ["distributor"],
        regionId,
        targetPath: "/crunzzo/distributor/notifications",
        targetTab: "notifications",
        data: { detail: distributorDetail, sourceId: `retailer-order-${orderId}` },
        sourceId: `retailer-order-${orderId}`,
        detail: distributorDetail,
        dedupeKey: `crunzzo:distributor:regional_retailer_purchase:${orderId}`,
      });
    }

    const results = await Promise.allSettled(
      notifications.map((notification) => createAppNotification(notification, { db }))
    );
    const rejected = results.find((result) => result.status === "rejected");
    if (rejected) {
      console.warn("One or more order notifications could not be sent:", rejected.reason);
    }
  };

  const handleDownloadCurrentInvoice = () => {
    if (!selectedItems.length) {
      alert("Please add items first.");
      return;
    }

    if (!validateCustomerInputs()) {
      setPendingSummaryAfterCustomer(true);
      goToScreen("customer");
      return;
    }

    downloadInvoiceFile(buildCurrentInvoiceData());
  };

  const submitSale = async () => {
    if (!userProfile || !selectedItems.length) return;

    if (!validateCustomerInputs()) {
      setPendingSummaryAfterCustomer(true);
      goToScreen("customer");
      return;
    }

    try {
      setSubmittingOrder(true);

      const now = new Date();
      const createdAtMs = Date.now();
      const invoiceNumber = `INV-${createdAtMs}`;

      const orderPayload = {
        invoiceNumber,
        orderType: isRetailer ? "retailer_purchase" : "distributor_sale",
        accountRole: dashboardMode,
        partnerRole: dashboardMode,
        partnerUid: userProfile.uid,
        partnerName: userProfile.name || auth.currentUser?.displayName || roleFallbackName,
        partnerId: userProfile.partnerId || userProfile.retailerId || userProfile.distributorId || "",
        ...(isRetailer
          ? {
              retailerUid: userProfile.uid,
              retailerName: userProfile.name || auth.currentUser?.displayName || "Retailer",
              retailerId: userProfile.retailerId || userProfile.partnerId || "",
            }
          : {
              distributorUid: userProfile.uid,
              distributorName: userProfile.name || auth.currentUser?.displayName || "Distributor",
              distributorId: userProfile.distributorId || userProfile.partnerId || "",
            }),
        region: userProfile.region,
        shopName: customer.shopName,
        phone: customer.phone,
        gst: customer.gst,
        salesPincode: customer.pincode,
        pincode: customer.pincode,
        subtotal,
        wholesaleDiscount,
        retailerOfferDiscount,
        discountTotal: wholesaleDiscount + retailerOfferDiscount,
        tax,
        total: totalSaleValue,
        totalUnits,
        itemCount: selectedItems.length,
        items: selectedItems.map((item) => ({
          productId: item.productId,
          packId: item.packId,
          packLabel: item.packLabel,
          packSize: item.packSize,
          totalUnits: item.totalUnits,
          name: item.name || "",
          category: item.category || "",
          quantity: item.quantity,
          unitLabel: item.unitLabel || "",
          rate: Number(item.rate || 0),
          rateLabel: `${formatRupees(item.rate)} / ${item.packLabel}`,
          gst: Number(item.gst || 0),
          offerPercent: Number(item.offerPercent || 0),
          lineDiscount: Number(item.lineDiscount || 0),
          lineNetTotal: Number(item.lineNetTotal || item.lineTotal || 0),
          lineTotal: item.lineTotal,
          imageUrl: item.imageUrl || "",
        })),
        createdAt: serverTimestamp(),
        createdAtMs,
        timeLabel: now.toLocaleString("en-IN", {
          day: "2-digit",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
        }),
      };

      const regionId = getCrunzzoRegionId(userProfile.region);
      const orderRef = doc(collection(db, "orders"));

      if (!regionId) {
        throw new Error("Your account does not have a valid Crunzzo region.");
      }

      const stockChanges = selectedItems.reduce((acc, item) => {
        acc[item.productId] = (acc[item.productId] || 0) + Number(item.totalUnits);
        return acc;
      }, {});

      await runTransaction(db, async (transaction) => {
        const stockSnapshots = {};

        for (const productId of Object.keys(stockChanges)) {
          const productRef = doc(db, "products", productId);
          const allocationDocId = regionalInventory[productId]?.id || productId;
          const allocationRef = doc(
            db,
            "regional_inventory",
            regionId,
            "products",
            allocationDocId
          );
          stockSnapshots[productId] = {
            product: await transaction.get(productRef),
            allocation: await transaction.get(allocationRef),
          };
        }

        for (const [productId, unitsToSubtract] of Object.entries(stockChanges)) {
          const { product, allocation } = stockSnapshots[productId];
          if (!product.exists() || !allocation.exists()) {
            throw new Error(`Regional stock data is unavailable for product ${productId}.`);
          }

          const currentStock = Number(product.data().stock || 0);
          const regionalStock = getRegionalRemainingUnits(allocation.data());
          if (currentStock < unitsToSubtract || regionalStock < unitsToSubtract) {
            throw new Error("Regional stock changed before the order could be synchronized.");
          }

          transaction.update(product.ref, {
            stock: currentStock - unitsToSubtract,
            regionalStock: {
              ...(product.data().regionalStock || {}),
              [regionId]: regionalStock - unitsToSubtract,
            },
            regionalStockUpdatedAtMs: Date.now(),
            updatedAtMs: Date.now(),
          });
          transaction.update(allocation.ref, {
            fulfilledUnits: Number(allocation.data().fulfilledUnits || 0) + unitsToSubtract,
            updatedAt: serverTimestamp(),
            updatedAtMs: Date.now(),
          });
        }

        transaction.set(orderRef, orderPayload);
      });

      await sendOrderNotifications(orderRef.id, orderPayload, regionId);

      setLastOrder({
        id: orderRef.id,
        ...orderPayload,
      });

      goToScreen("success");
      setCart({});
      setPendingSummaryAfterCustomer(false);
    } catch (error) {
      console.error("Submit sale error:", error);
      alert(error.message || "Failed to save sale in Firebase.");
    } finally {
      setSubmittingOrder(false);
    }
  };

  const handleWhatsappShare = () => {
    if (!lastOrder) return;

    const text = `Hello ${lastOrder.shopName || ""}, your Crunzzo order ${lastOrder.invoiceNumber || ""
      } of ${formatRupees(lastOrder.total || 0)} has been recorded successfully.`;

    const url = `https://wa.me/${lastOrder.phone || ""}?text=${encodeURIComponent(text)}`;
    window.open(url, "_blank");
  };

  const renderProductVisual = (product) => {
    if (product.imageUrl) {
      return <img src={product.imageUrl} alt={product.name} className="bzd-product-image" />;
    }

    return (
      <div className="bzd-product-fallback">
        <span>{product.name}</span>
      </div>
    );
  };

  const renderMobileNav = (active) => (
    <div
      className="bzd-bottom-nav"
      style={{
        position: "relative",
        left: "auto",
        right: "auto",
        bottom: "auto",
        width: "100%",
        margin: 0,
        zIndex: 2,
        flexShrink: 0,
        background: "#fff",
      }}
    >
      <button
        type="button"
        className={active === "home" ? "active" : ""}
        onClick={() => goToScreen("home")}
      >
        <DashboardNavIcon type="home" active={active === "home"} />
        <span>Home</span>
      </button>

      <button
        type="button"
        className={active === "products" ? "active" : ""}
        onClick={() => goToScreen("products")}
      >
        <DashboardNavIcon type="products" active={active === "products"} />
        <span>Inventory</span>
      </button>

      <button
        type="button"
        className={active === "history" ? "active" : ""}
        onClick={() => goToScreen("history")}
      >
        <DashboardNavIcon type="history" active={active === "history"} />
        <span>Orders</span>
      </button>

      <button
        type="button"
        className={active === "profile" ? "active" : ""}
        onClick={() => goToScreen("profile")}
      >
        <DashboardNavIcon type="profile" active={active === "profile"} />
        <span>Profile</span>
      </button>
    </div>
  );

  if (loadingProfile || loadingProducts || loadingRegionalInventory || loadingOrders) {
    return (
      <div className="bzd-page" data-brand="crunzzo">
        <ThemeOverrides />
        <div className="bzd-shell bzd-shell-light">
          <div style={{ padding: "40px 0", textAlign: "center", color: "#7d879b" }}>
            Loading Crunzzo {roleLabel.toLowerCase()} data...
          </div>
        </div>
      </div>
    );
  }

  if (!userProfile) {
    return (
      <div className="bzd-page" data-brand="crunzzo">
        <ThemeOverrides />
        <div className="bzd-shell bzd-shell-light">
          <div style={{ padding: "40px 0", textAlign: "center", color: "#7d879b" }}>
            Please log in again to continue.
          </div>
        </div>
      </div>
    );
  }

  if (screen === "profile") {
    return (
      <div className="bzd-page" data-brand="crunzzo">
        <ThemeOverrides />
        <div
          className="bzd-shell bzd-shell-light"
          style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}
        >
          <div style={{ flex: 1, overflowY: "auto", padding: "6px 2px 20px" }}>
            <div style={{ display: "flex", justifyContent: "center" }}>
              <div style={{ position: "relative" }}>
                {profilePreview ? (
                  <img
                    src={profilePreview}
                    alt={profileForm.name || "Profile"}
                    style={{
                      width: 86,
                      height: 86,
                      borderRadius: "50%",
                      objectFit: "cover",
                      border: "3px solid #fff",
                      boxShadow: "0 6px 18px rgba(0,0,0,0.08)",
                    }}
                  />
                ) : (
                  <div
                    style={{
                      width: 86,
                      height: 86,
                      borderRadius: "50%",
                      display: "grid",
                      placeItems: "center",
                      background: "linear-gradient(180deg,#d0d5de 0%,#a9b3c3 100%)",
                      color: "#fff",
                      fontSize: 28,
                      fontWeight: 800,
                      border: "3px solid #fff",
                      boxShadow: "0 6px 18px rgba(0,0,0,0.08)",
                    }}
                  >
                    {(profileForm.name || "D").charAt(0).toUpperCase()}
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  style={{
                    position: "absolute",
                    right: -4,
                    bottom: 2,
                    width: 28,
                    height: 28,
                    borderRadius: "50%",
                    border: "2.5px solid #fff",
                    background: BRAND_ACCENT,
                    color: "#fff",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    cursor: "pointer",
                    boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
                  }}
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                    <circle cx="12" cy="13" r="4" />
                  </svg>
                </button>

                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={handleProfileImagePick}
                />
              </div>
            </div>

            <h2
              style={{
                margin: "12px 0 2px",
                textAlign: "center",
                fontSize: 28,
                fontWeight: 800,
                color: "#20263a",
              }}
            >
              {profileForm.name || roleFallbackName}
            </h2>

            <p
              style={{
                margin: 0,
                textAlign: "center",
                color: "#7d879b",
                fontSize: 13,
              }}
            >
              {roleLabel} Partner • {profileForm.territory || "North Region"}
            </p>

            <div style={{ display: "flex", justifyContent: "center", marginTop: 14 }}>
              <button
                type="button"
                onClick={() => {
                  setProfileOpen((prev) => !prev);
                  setProfileMessage("");
                }}
                style={{
                  height: 36,
                  padding: "0 20px",
                  borderRadius: 999,
                  border: `1.5px solid ${BRAND_ACCENT}55`,
                  background: "#fff",
                  color: BRAND_ACCENT,
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                ✎ Edit Profile
              </button>
            </div>

            {profileMessage ? (
              <div
                style={{
                  marginTop: 14,
                  background: profileMessage.includes("successfully") ? "#eef9f0" : "#fff0f0",
                  color: profileMessage.includes("successfully") ? "#27944e" : "#d42424",
                  border: `1px solid ${profileMessage.includes("successfully") ? "#d7f0dc" : "#ffd1d1"
                    }`,
                  borderRadius: "12px",
                  padding: "10px 12px",
                  fontSize: "13px",
                  fontWeight: 700,
                }}
              >
                {profileMessage}
              </div>
            ) : null}

            {profileOpen ? (
              <div
                style={{
                  marginTop: 16,
                  background: "#fff",
                  border: "1px solid #ececec",
                  borderRadius: 18,
                  padding: 14,
                  display: "grid",
                  gap: 12,
                }}
              >
                <label style={{ display: "grid", gap: 6 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: "#7d879b" }}>FULL NAME</span>
                  <input
                    name="name"
                    value={profileForm.name}
                    onChange={handleProfileInputChange}
                    placeholder="Enter full name"
                    style={{
                      height: 46,
                      borderRadius: 12,
                      border: "1px solid #e4e8f0",
                      padding: "0 14px",
                      outline: "none",
                    }}
                  />
                </label>

                <label style={{ display: "grid", gap: 6 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: "#7d879b" }}>BUSINESS NAME</span>
                  <input
                    name="businessName"
                    value={profileForm.businessName}
                    onChange={handleProfileInputChange}
                    placeholder="Enter business name"
                    style={{
                      height: 46,
                      borderRadius: 12,
                      border: "1px solid #e4e8f0",
                      padding: "0 14px",
                      outline: "none",
                    }}
                  />
                </label>

                <label style={{ display: "grid", gap: 6 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: "#7d879b" }}>PHONE NUMBER</span>
                  <input
                    type="tel"
                    name="phone"
                    inputMode="numeric"
                    maxLength={10}
                    value={profileForm.phone}
                    onChange={handleProfileInputChange}
                    placeholder="Enter 10 digit number"
                    style={{
                      height: 46,
                      borderRadius: 12,
                      border: "1px solid #e4e8f0",
                      padding: "0 14px",
                      outline: "none",
                    }}
                  />
                </label>

                <label style={{ display: "grid", gap: 6 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: "#7d879b" }}>TERRITORY</span>
                  <input
                    name="territory"
                    value={profileForm.territory}
                    onChange={handleProfileInputChange}
                    placeholder="e.g. North Region"
                    style={{
                      height: 46,
                      borderRadius: 12,
                      border: "1px solid #e4e8f0",
                      padding: "0 14px",
                      outline: "none",
                    }}
                  />
                </label>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <button
                    type="button"
                    onClick={() => {
                      setProfileOpen(false);
                      setProfileImageFile(null);
                      setProfilePreview(userProfile?.profileImageUrl || "");
                      setProfileForm({
                        name: userProfile?.name || "",
                        businessName: userProfile?.businessName || "",
                        phone: userProfile?.phone || "",
                        territory: userProfile?.territory || userProfile?.zone || "North Region",
                      });
                      setProfileMessage("");
                    }}
                    style={{
                      height: 44,
                      borderRadius: 12,
                      border: "1px solid #e4e8f0",
                      background: "#fff",
                      color: "#5e677a",
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    Cancel
                  </button>

                  <button
                    type="button"
                    onClick={handleSaveProfile}
                    disabled={profileSaving}
                    style={{
                      height: 44,
                      borderRadius: 12,
                      border: "none",
                      background: `linear-gradient(180deg, ${BRAND_GRAD_FROM} 0%, ${BRAND_GRAD_TO} 100%)`,
                      color: "#fff",
                      fontWeight: 800,
                      cursor: "pointer",
                    }}
                  >
                    {profileSaving ? "Saving..." : "Save"}
                  </button>
                </div>
              </div>
            ) : null}

            <div
              style={{
                marginTop: 22,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <h3 style={{ margin: 0, fontSize: 20, color: "#20263a" }}>My Performance</h3>
              <button
                type="button"
                onClick={() => {
                  setHistoryFilter("month");
                  goToScreen("history");
                }}
                style={{
                  border: "none",
                  background: "transparent",
                  color: BRAND_ACCENT,
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                Monthly View
              </button>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
              <div
                style={{
                  background: "#fff",
                  border: "1px solid #ececec",
                  borderRadius: 16,
                  padding: 14,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8, color: BRAND_ACCENT }}>
                  <span style={{ fontSize: 14 }}>▣</span>
                  <small style={{ color: "#7d879b" }}>{isRetailer ? "Total Purchases" : "Total Sales"}</small>
                </div>
                <strong style={{ display: "block", marginTop: 8, fontSize: 18, color: "#20263a" }}>
                  {formatCompactRupees(todayRevenue)}
                </strong>
                <span style={{ display: "block", marginTop: 6, color: "#27944e", fontSize: 12, fontWeight: 700 }}>
                  ↑ 12%
                </span>
              </div>

              <div
                style={{
                  background: "#fff",
                  border: "1px solid #ececec",
                  borderRadius: 16,
                  padding: 14,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8, color: BRAND_ACCENT }}>
                  <span style={{ fontSize: 14 }}>▣</span>
                  <small style={{ color: "#7d879b" }}>Total Item Sold</small>
                </div>
                <strong style={{ display: "block", marginTop: 8, fontSize: 18, color: "#20263a" }}>
                  {todayUnits}
                </strong>
                <span style={{ display: "block", marginTop: 6, color: "#27944e", fontSize: 12, fontWeight: 700 }}>
                  ↑ 8%
                </span>
              </div>
            </div>

            <div style={{ marginTop: 18 }}>
              <h3 style={{ margin: "0 0 10px", fontSize: 18, color: "#20263a" }}>App & Inventory</h3>
              <div style={{ display: "grid", gap: 10 }}>
                <ProfileMenuRow
                  icon="🗃"
                  title="Inventory Access"
                  subtitle="View real-time stock levels"
                  onClick={() => goToScreen("products")}
                  accent={BRAND_ACCENT}
                />
                <ProfileMenuRow
                  icon="🧾"
                  title={isRetailer ? "My Purchase History" : "My Sales History"}
                  subtitle={isRetailer ? "Track your completed purchases" : "Track your closed deals"}
                  onClick={() => goToScreen("history")}
                  accent={BRAND_ACCENT}
                />
              </div>
            </div>

            <div style={{ marginTop: 18 }}>
              <h3 style={{ margin: "0 0 10px", fontSize: 18, color: "#20263a" }}>Support & Settings</h3>
              <div style={{ display: "grid", gap: 10 }}>
                <ProfileMenuRow
                  icon="?"
                  title="Help & Support"
                  subtitle="FAQs and customer support"
                  onClick={() => { }}
                  accent={BRAND_ACCENT}
                />
              </div>
            </div>

            <button
              type="button"
              onClick={() => setShowLogoutConfirm(true)}
              style={{
                marginTop: 20,
                width: "100%",
                height: 48,
                borderRadius: 12,
                border: "none",
                background: `linear-gradient(180deg, ${BRAND_GRAD_FROM} 0%, ${BRAND_GRAD_TO} 100%)`,
                color: "#fff",
                fontWeight: 800,
                cursor: "pointer",
                boxShadow: "0 10px 20px rgba(229,31,40,0.18)",
              }}
            >
              Logout Account
            </button>
          </div>

          <div style={{ flexShrink: 0, background: "#fff" }}>{renderMobileNav("profile")}</div>
        </div>

        {showLogoutConfirm && (
          <div className="crz-logout-overlay" onClick={() => setShowLogoutConfirm(false)}>
            <div className="crz-logout-modal" onClick={(e) => e.stopPropagation()}>
              <h3>Logout</h3>
              <p>Are you sure you want to logout?</p>
              <div className="crz-logout-actions">
                <button className="crz-logout-cancel" onClick={() => setShowLogoutConfirm(false)}>Cancel</button>
                <button className="crz-logout-confirm" onClick={handleLogout}>Yes</button>
              </div>
            </div>
          </div>
        )}
      </div>
  );
}

  if (screen === "customer") {
    return (
      <div className="bzd-page" data-brand="crunzzo">
        <ThemeOverrides />
        <div className="bzd-shell bzd-shell-light">
          <div className="bzd-topbar-step">
            <button type="button" className="bzd-back-btn" onClick={() => goToScreen("home")}>
              ←
            </button>
            <h2>New {transactionLabel}</h2>
            <span className="bzd-top-placeholder" />
          </div>

          <div className="bzd-step-content">
            <h1>Customer Details</h1>
            <p>Step 1 of 3: Enter the shop's basic information.</p>

            <div className="bzd-form-list">
              <label>
                <span>Shop Name</span>
                <input
                  name="shopName"
                  value={customer.shopName}
                  onChange={handleCustomerChange}
                  placeholder="Enter shop name"
                />
              </label>

              <label>
                <span>Contact Phone</span>
                <input
                  type="tel"
                  inputMode="numeric"
                  maxLength={10}
                  name="phone"
                  value={customer.phone}
                  onChange={handleCustomerChange}
                  placeholder="+91 98765 43210"
                />
              </label>

              <label>
                <span>GST or PAN Number</span>
                <input
                  type="text"
                  name="gst"
                  maxLength={15}
                  value={customer.gst}
                  onChange={handleCustomerChange}
                  placeholder="GST or PAN Card Number"
                />
              </label>

            <label>
              <span>Sales Pincode</span>
              <input
                type="tel"
                name="pincode"
                inputMode="numeric"
                maxLength={6}
                value={customer.pincode}
                onChange={handleCustomerChange}
                placeholder="e.g. 400097"
              />
            </label>
            </div>

            {customerError ? (
              <div
                style={{
                  marginTop: "14px",
                  background: "#fff0f0",
                  color: "#d42424",
                  border: "1px solid #ffd1d1",
                  borderRadius: "12px",
                  padding: "10px 12px",
                  fontSize: "13px",
                  fontWeight: 700,
                }}
              >
                {customerError}
              </div>
            ) : null}
          </div>

          <div className="bzd-step-footer">
            <button
              type="button"
              className="bzd-primary-btn"
              disabled={!customer.shopName.trim() || !customer.phone.trim()}
              onClick={moveToProducts}
            >
              Next Step →
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (screen === "products") {
    return (
      <div className="czd-page" data-brand="crunzzo">
        <ThemeOverrides />
        <div
          className="czd-shell czd-shell-light"
          style={{
            display: "flex",
            flexDirection: "column",
            minHeight: "100dvh",
            height: "100dvh",
            overflow: "hidden",
            padding: "16px 16px 0",
          }}
        >
          <div
            style={{
              flex: 1,
              minHeight: 0,
              overflowY: "auto",
              paddingBottom: 14,
            }}
          >
            <div className="czd-topbar-step">
              <button type="button" className="czd-back-btn" onClick={() => goToScreen("customer")}>
                ←
              </button>

              <div className="czd-step-center">
                <small>STEP 2 OF 4</small>
                <h2>Product Selection</h2>
              </div>

              <button type="button" className="czd-info-btn">
                i
              </button>
            </div>

            <div className="czd-search-wrap">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search SKU or product name"
              />
            </div>

            <div className="czd-regional-stock-note">
              Showing stock allocated to <strong>{userProfile.region}</strong> only
            </div>

            {regionalStockUnavailable ? (
              <div className="czd-regional-stock-warning">
                Regional stock is temporarily unavailable. It has not been marked as zero.
              </div>
            ) : null}

            <div className="czd-filter-row">
              {categoryTabs.map((tab) => (
                <button
                  key={tab}
                  type="button"
                  className={category === tab ? "active" : ""}
                  onClick={() => setCategory(tab)}
                >
                  {tab === "all" ? "All SKUs" : tab}
                </button>
              ))}
            </div>

            {!filteredProducts.length ? (
              <div
                style={{
                  background: "#fff",
                  border: "1px solid #ececec",
                  borderRadius: "18px",
                  padding: "20px",
                  textAlign: "center",
                  color: "#7d879b",
                  marginBottom: 10,
                }}
              >
                No products available. Please ask admin to upload products first.
              </div>
            ) : (
              <div className="czd-product-grid">
                {filteredProducts.map((product) => {
                  const packOptions = normalizeCrunzzoPackOptions(product);
                  const regionalStockState = getRegionalStockState(product.id);
                  const totalAvailableUnits = regionalStockState.availableUnits;
                  const primaryPrice = packOptions.find((pack) => Number(pack.rate || 0) > 0)?.rate || 0;
                  const retailerOfferPercent = getRetailerOfferPercent(product);
                  const hasOrderablePack = packOptions.some(
                    (pack) => Math.floor(totalAvailableUnits / Math.max(1, Number(pack.packSize || 1))) > 0
                  );
                  const isOutOfStock = totalAvailableUnits <= 0 || !hasOrderablePack;
                  const isStockUnavailable = !regionalStockState.isAvailable;
                  const selectedPackCount = selectedItems
                    .filter((item) => item.productId === product.id)
                    .reduce((sum, item) => sum + item.quantity, 0);

                  return (
                    <div className="czd-product-card" key={product.id} style={{ opacity: isOutOfStock || isStockUnavailable ? 0.6 : 1 }}>
                      {isRetailer && retailerOfferPercent > 0 ? (
                        <div className="czd-offer-badge" aria-label={`${retailerOfferPercent}% offer`}>
                          {retailerOfferPercent}%
                        </div>
                      ) : null}
                      <div className="czd-product-thumb">{renderProductVisual(product)}</div>

                      <div className="czd-product-meta">
                        <h4>{product.name}</h4>
                        <strong className="czd-product-price">
                          {primaryPrice > 0 ? `From ${formatRupees(primaryPrice)}` : "Price not set"}
                        </strong>
                        <small style={{ color: isOutOfStock ? BRAND_ACCENT : "#7d879b", fontWeight: 700 }}>
                          {isStockUnavailable
                            ? "STOCK UNAVAILABLE"
                            : isOutOfStock
                              ? "OUT OF STOCK"
                              : `${totalAvailableUnits} Units in ${userProfile.region}`}
                        </small>
                        <p>{product.description || product.category || "-"}</p>
                      </div>

                      <button
                        type="button"
                        className="czd-add-btn czd-add-with-options"
                        onClick={() => setSelectedProductForPacks(product)}
                        disabled={isOutOfStock || isStockUnavailable}
                        style={isOutOfStock || isStockUnavailable ? { background: "#aab2bd", cursor: "not-allowed" } : {}}
                      >
                        {isStockUnavailable ? (
                          <span>UNAVAILABLE</span>
                        ) : isOutOfStock ? (
                          <span>OUT OF STOCK</span>
                        ) : selectedPackCount > 0 ? (
                          <>
                            <span>ADD</span>
                            <small>{selectedPackCount} Selected</small>
                          </>
                        ) : (
                          <>
                            <span>ADD</span>
                            <small>2 Packs</small>
                          </>
                        )}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {selectedProductForPacksLive && (
            <div className="czd-options-overlay">
              <div className="czd-options-sheet">
                <button
                  type="button"
                  className="czd-options-close"
                  onClick={() => setSelectedProductForPacks(null)}
                >
                  x
                </button>

                <div className="czd-options-header">
                  <button
                    type="button"
                    className="bzd-back-btn"
                    onClick={() => setSelectedProductForPacks(null)}
                  >
                    ←
                  </button>
                  <div>
                    <h3>{selectedProductForPacksLive.name}</h3>
                    <p>{selectedProductForPacksLive.description || selectedProductForPacksLive.category || "Crunzzo SKU"}</p>
                  </div>
                </div>

                <div className="czd-options-list">
                  {normalizeCrunzzoPackOptions(selectedProductForPacksLive).map((pack) => {
                    const cartKey = `${selectedProductForPacksLive.id}_${pack.id}`;
                    const qty = cart[cartKey] || 0;
                    const regionalUnits = getRegionalAvailableUnits(selectedProductForPacksLive.id);
                    const selectedUnitsForProduct = selectedItems
                      .filter((item) => item.productId === selectedProductForPacksLive.id)
                      .reduce((sum, item) => sum + Number(item.totalUnits || 0), 0);
                    const unitsSelectedInThisPack = qty * Number(pack.packSize || 0);
                    const unitsAvailableForThisPack = Math.max(
                      0,
                      regionalUnits - (selectedUnitsForProduct - unitsSelectedInThisPack)
                    );
                    const availableStock = Math.floor(
                      unitsAvailableForThisPack / Math.max(1, Number(pack.packSize || 1))
                    );
                    const isPackOut = availableStock <= 0;
                    const offerPercent = isRetailer ? getRetailerOfferPercent(selectedProductForPacksLive) : 0;
                    const discountedRate = Number(pack.rate || 0) * (1 - offerPercent / 100);

                    return (
                      <div className="czd-option-row" key={pack.id}>
                        <div className="czd-option-thumb">
                          {renderProductVisual(selectedProductForPacksLive)}
                        </div>

                        <div className="czd-option-info">
                          <span className="czd-option-label">{pack.label}</span>
                          <span className="czd-option-price">
                            {offerPercent > 0 ? `${formatRupees(discountedRate)} after offer` : formatRupees(pack.rate)}
                          </span>
                          <small className={isPackOut ? "czd-option-stock is-out" : "czd-option-stock"}>
                            GST {pack.gst}% • {offerPercent > 0 ? `${offerPercent}% off • ` : ""}{isPackOut ? "OUT OF STOCK" : `${availableStock} packs in ${userProfile.region}`}
                          </small>
                        </div>

                        {qty > 0 ? (
                          <div className="czd-option-qty">
                            <button type="button" onClick={() => removeFromCart(selectedProductForPacksLive.id, pack.id)}>
                              -
                            </button>
                            <span>{qty}</span>
                            <button
                              type="button"
                              onClick={() => addToCart(selectedProductForPacksLive.id, pack.id)}
                              disabled={qty >= availableStock}
                            >
                              +
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            className={isPackOut ? "czd-option-add is-disabled" : "czd-option-add"}
                            onClick={() => addToCart(selectedProductForPacksLive.id, pack.id)}
                            disabled={isPackOut}
                          >
                            {isPackOut ? "OUT" : "ADD"}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>

                <div className="czd-options-footer">
                  <div className="czd-options-footer-total">
                    <small>{totalUnits} ITEMS SELECTED</small>
                    <strong>{formatRupees(cartPreviewTotal)} Total</strong>
                  </div>
                  <button
                    type="button"
                    className="czd-options-review-btn"
                    disabled={!selectedItems.length}
                    onClick={() => {
                      setSelectedProductForPacks(null);
                      moveToSummary();
                    }}
                  >
                    Review Order →
                  </button>
                </div>
              </div>
            </div>
          )}

          <div
            className="czd-bottom-nav-container"
            style={{
              flexShrink: 0,
              background: "#fff",
              borderTop: "1px solid #ececec",
              boxShadow: "0 -8px 18px rgba(0,0,0,0.04)",
            }}
          >
            <div
              style={{
                padding: "10px 14px 10px",
                display: "grid",
                gridTemplateColumns: "1fr 0.95fr",
                gap: 12,
              }}
            >
              <div className="czd-review-total">
                <small>{totalUnits} ITEMS SELECTED</small>
                <strong>{formatRupees(cartPreviewTotal)} Total</strong>
              </div>

              <button
                type="button"
                className="czd-review-btn"
                disabled={!selectedItems.length}
                onClick={moveToSummary}
              >
                Review Order →
              </button>
            </div>

            {renderMobileNav("products")}
          </div>
        </div>
      </div>
    );
  }

  if (screen === "summary") {
    return (
      <div className="bzd-page" data-brand="crunzzo">
        <ThemeOverrides />
        <div className="bzd-shell bzd-shell-light">
          <div className="bzd-topbar-step">
            <button type="button" className="bzd-back-btn" onClick={() => goToScreen("products")}>
              ←
            </button>
            <h2>Order Summary</h2>
            <span className="bzd-top-placeholder" />
          </div>

          <div className="bzd-progress-row">
            <span />
            <span />
            <span className="active" />
          </div>

          <div className="bzd-summary-block">
            <h3>Review Products</h3>
            <p>{selectedItems.length} items in your cart</p>

            <div className="bzd-summary-list">
              {selectedItems.map((item) => (
                <div className="bzd-summary-item" key={item.id}>
                  <div className="bzd-summary-thumb">
                    {item.imageUrl ? (
                      <img src={item.imageUrl} alt={item.name} />
                    ) : (
                      <div className="bzd-summary-fallback">{item.name}</div>
                    )}
                  </div>

                  <div className="bzd-summary-copy">
                    <h4>{item.name}</h4>
                    <p>Qty: {item.quantity} x {item.packLabel} ({item.totalUnits} units)</p>
                    <small>{item.rateLabel}</small>
                  </div>

                  <strong>{formatRupees(item.linePayable || item.lineTotal)}</strong>
                </div>
              ))}
            </div>
          </div>

          <div className="bzd-order-card">
            <h3>Order Details</h3>

            <div className="bzd-order-rows">
              <div>
                <span>Subtotal</span>
                <strong>{formatRupees(subtotal)}</strong>
              </div>
              <div>
                <span>{isRetailer ? "Product Offers" : "Wholesale Discount (5%)"}</span>
                <strong className="green">-{formatRupees(isRetailer ? retailerOfferDiscount : wholesaleDiscount)}</strong>
              </div>
              <div>
                <span>GST</span>
                <strong>{formatRupees(tax)}</strong>
              </div>
            </div>
          </div>

          <div className="bzd-total-card">
            <div>
              <small>{isRetailer ? "TOTAL PURCHASE VALUE" : "TOTAL SALE VALUE"}</small>
              <strong>{formatRupees(totalSaleValue)}</strong>
            </div>
          </div>

          <button
            type="button"
            className="bzd-primary-btn"
            onClick={submitSale}
            disabled={submittingOrder}
          >
            {submittingOrder ? "Submitting..." : `Submit ${transactionLabel} ▷`}
          </button>
        </div>
      </div>
    );
  }

  if (screen === "success") {
    return (
      <div className="bzd-page" data-brand="crunzzo">
        <ThemeOverrides />
        <div className="bzd-shell bzd-shell-light">
          <div className="bzd-topbar-step">
            <button type="button" className="bzd-back-btn" onClick={() => goToScreen("home")}>
              ←
            </button>
            <h2>{transactionLabel} Confirmation</h2>
            <span className="bzd-top-placeholder" />
          </div>

          <div className="bzd-success-wrap">
            <div className="bzd-success-icon">✓</div>
            <h1>{transactionLabel} Recorded Successfully!</h1>
            <p>
              Your transaction has been processed and added to
              <br />
              the daily ledger.
            </p>

            <div className="bzd-success-card">
              <div className="bzd-success-shop">
                <div className="bzd-shop-thumb">🏪</div>
                <div>
                  <small>SHOP NAME</small>
                  <h3>{lastOrder?.shopName || "-"}</h3>
                </div>
              </div>

              <div className="bzd-success-divider" />

              <div className="bzd-success-total">
                <div>
                  <small>TOTAL VALUE</small>
                  <strong>{formatRupees(lastOrder?.total || 0)}</strong>
                </div>

                <div className="bzd-success-actions">
                  <button
                    type="button"
                    className="whatsapp"
                    onClick={handleWhatsappShare}
                    style={{ background: "#25D366", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}
                  >
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.414 0 .018 5.396.015 12.03a11.811 11.811 0 001.592 5.96L0 24l6.117-1.605a11.82 11.82 0 005.925 1.587h.005c6.632 0 12.032-5.4 12.035-12.034a11.84 11.84 0 00-3.527-8.498z" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          </div>

          <button
            type="button"
            className="bzd-secondary-btn"
            onClick={() => downloadInvoiceFile(lastOrder)}
            style={{ marginBottom: 12 }}
          >
            Download Invoice
          </button>

          <button type="button" className="bzd-primary-btn" onClick={startNewSale}>
            Log Another {transactionLabel}
          </button>

          <button type="button" className="bzd-secondary-btn" onClick={() => goToScreen("home")}>
            Back to Home
          </button>
        </div>
      </div>
    );
  }

  if (screen === "history") {
    return (
      <div className="bzd-page" data-brand="crunzzo">
        <ThemeOverrides />
        <div
          className="bzd-shell bzd-shell-light"
          style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}
        >
          <div style={{ flex: 1, overflowY: "auto" }}>
            <div className="bzd-topbar-step">
              <button type="button" className="bzd-back-btn" onClick={() => goToScreen("home")}>
                ←
              </button>
              <h2>Daily {transactionLabel} History</h2>
              <span className="bzd-top-placeholder" />
            </div>

            <div className="bzd-history-hero">
              <small>
                {getFilterLabel(historyFilter, startDate, endDate)}
              </small>
              <strong>{formatRupees(historyTotal)}</strong>
              <span>{filteredOrders.length} Transactions</span>
            </div>

            <HistoryDateFilter
              historyFilter={historyFilter}
              setHistoryFilter={setHistoryFilter}
              startDate={startDate}
              setStartDate={setStartDate}
              endDate={endDate}
              setEndDate={setEndDate}
              accentColor={BRAND_ACCENT}
            />

            <div className="bzd-search-wrap bzd-history-search">
              <input
                placeholder="Search shop name, ID..."
                value={historySearch}
                onChange={(e) => setHistorySearch(e.target.value)}
              />
            </div>

            <div className="bzd-history-day">
              {getFilterHeading(historyFilter, startDate, endDate)}
            </div>

            {!filteredOrders.length ? (
              <div
                style={{
                  background: "#fff",
                  border: "1px solid #ececec",
                  borderRadius: "18px",
                  padding: "20px",
                  textAlign: "center",
                  color: "#7d879b",
                }}
              >
                No {transactionNoun}s recorded yet.
              </div>
            ) : (
              <div className="bzd-history-list">
                {filteredOrders.map((item, index) => (
                  <div className="bzd-history-row" key={item.id}>
                    <div
                      className="bzd-history-avatar"
                      style={{ background: getAvatarBg(index) }}
                    >
                      {item.shopName?.charAt(0) || "S"}
                    </div>

                    <div className="bzd-history-copy">
                      <h4>{item.shopName}</h4>
                      <p>ID: #{8817 + index} • {item.timeLabel || "-"}</p>
                    </div>

                    <strong>{formatRupees(item.total)}</strong>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={{ flexShrink: 0, background: "#fff" }}>{renderMobileNav("history")}</div>
        </div>
      </div>
    );
  }

  if (screen === "notifications") {
    return (
      <div className="bzd-page" data-brand="crunzzo">
        <ThemeOverrides />
        <div
          className="bzd-shell bzd-shell-light"
          style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}
        >
          <div style={{ flex: 1, overflowY: "auto" }}>
            <div className="bzd-topbar-step">
              <button type="button" className="bzd-back-btn" onClick={() => goToScreen("home")}>
                ←
              </button>
              <h2>Notifications</h2>
              <span className="bzd-top-placeholder" />
            </div>

            <div className="czd-notification-title">
              <h1>Regional Retailer Orders</h1>
              <p>Retailer purchases from your region appear here.</p>
            </div>

            {notificationError ? (
              <div className="czd-notification-error">
                {notificationError}
              </div>
            ) : null}

            <div className="czd-notification-list">
              {prioritizedDistributorNotifications.length ? (
                prioritizedDistributorNotifications.map((item) => {
                  const isViewed = isAppNotificationViewed(item, userProfile?.uid, viewedNotifications);
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className={`czd-notification-card${isViewed ? " is-viewed" : ""}`}
                      onClick={() => openDistributorNotification(item)}
                      style={{ order: isViewed ? 2 : 1 }}
                    >
                      <span className="czd-notification-marker" style={{ background: isViewed ? "#cfd5df" : item.tone }} />
                      <span className="czd-notification-copy">
                        <span className="czd-notification-head">
                          <strong>{item.title}</strong>
                          <small>{item.time}</small>
                        </span>
                        <span className="czd-notification-message">{item.message}</span>
                        <b className={`czd-notification-pill${isViewed ? " is-viewed" : ""}`}>
                          {isViewed ? "Viewed" : "New"}
                        </b>
                      </span>
                    </button>
                  );
                })
              ) : (
                <div className="bzd-empty-card">
                  No regional retailer notifications yet.
                </div>
              )}
            </div>
          </div>

          <div style={{ flexShrink: 0, background: "#fff" }}>{renderMobileNav("home")}</div>
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
              aria-labelledby="distributor-notification-detail-title"
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
              <h3 id="distributor-notification-detail-title" style={{ marginBottom: 6 }}>
                {selectedNotification.title}
              </h3>
              <p style={{ margin: "0 0 12px", color: "#7d879b", fontSize: 12 }}>
                {selectedNotification.time}
              </p>
              <p style={{ margin: "0 0 12px", color: "#20263a", fontSize: 13, lineHeight: 1.45 }}>
                {selectedNotification.message}
              </p>
              <div className="czd-notification-detail">
                {selectedNotification.detail || selectedNotification.message}
              </div>
              <button
                type="button"
                className="crz-logout-confirm"
                onClick={() => setSelectedNotification(null)}
                style={{ width: "100%", marginTop: 14 }}
              >
                Close
              </button>
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="bzd-page" data-brand="crunzzo">
      <ThemeOverrides />
      <div
        className="bzd-shell bzd-shell-home"
        style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}
      >
        <div style={{ flex: 1, overflowY: "auto" }}>
          <div className="bzd-home-topbar">
            <div className="bzd-home-left">
              <button
                type="button"
                className="czd-user-avatar"
                onClick={() => goToScreen("profile")}
                aria-label="Open profile"
              >
                {userProfile?.profileImageUrl ? (
                  <img
                    src={userProfile.profileImageUrl}
                    alt={userProfile.name || "Profile"}
                    style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "inherit" }}
                  />
                ) : (
                  (userProfile?.name || "D").charAt(0).toUpperCase()
                )}
              </button>
              <div>
                <h3>Dashboard</h3>
                <p>Welcome back, {(userProfile?.name || roleFallbackName).toUpperCase()}</p>
              </div>
            </div>

            <div className="bzd-home-right">
              <button
                type="button"
                className="bzd-bell-btn czd-notification-bell"
                onClick={() => goToScreen("notifications")}
                aria-label="Open notifications"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
                  <path d="M10 21h4" />
                </svg>
                {unreadDistributorNotificationCount ? (
                  <span className="czd-bell-badge">{unreadDistributorNotificationCount}</span>
                ) : null}
              </button>
              <button type="button" className="bzd-bell-btn">🔔</button>
              <img src={crunzzoLogo} alt="Crunzzo" className="bzd-header-logo" />
            </div>
          </div>

          <div className="bzd-hero-block">
            {isRetailer ? (
              <div className="czd-retailer-promo-ribbon">
                buy 2 boxes and get 1 box free
              </div>
            ) : null}
            <h1>Ready to {transactionVerb}?</h1>
            <p>Log a new transaction immediately.</p>
            <img src={crunzzoLogo} alt="Crunzzo" className="bzd-hero-logo" />

            <button type="button" className="bzd-primary-btn" onClick={startNewSale}>
              ⊕ New {transactionLabel}
            </button>
          </div>

          <div className="bzd-sales-card">
            <div className="bzd-sales-head">
              <h2>{transactionLabel}s Today</h2>
              <span>{orders.length ? "Live data" : `No ${transactionNoun}s yet`}</span>
            </div>

            <div className="bzd-sales-grid">
              <div>
                <small>Revenue</small>
                <strong>{formatRupees(todayRevenue)}</strong>
              </div>

              <div>
                <small>Units Sold</small>
                <strong>{todayUnits}</strong>
              </div>
            </div>
          </div>

          <div className="bzd-section-head">
            <h2>Recent Activity</h2>
            <button type="button" onClick={() => goToScreen("history")}>
              View All
            </button>
          </div>

          {!recentActivity.length ? (
            <div
              style={{
                background: "#fff",
                border: "1px solid #ececec",
                borderRadius: "18px",
                padding: "20px",
                textAlign: "center",
                color: "#7d879b",
              }}
            >
              No recent activity yet.
            </div>
          ) : (
            <div className="bzd-activity-list">
              {recentActivity.map((item, index) => (
                <div className="bzd-activity-card" key={item.id}>
                  <div
                    className={`bzd-activity-icon ${index % 3 === 0 ? "red" : index % 3 === 1 ? "orange" : "purple"
                      }`}
                  >
                    🏪
                  </div>

                  <div className="bzd-activity-copy">
                    <h4>{item.shopName}</h4>
                    <p>{item.timeLabel || "-"}</p>
                  </div>

                  <div className="bzd-activity-right">
                    <strong>{formatRupees(item.total)}</strong>
                    <span>Completed</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ flexShrink: 0, background: "#fff" }}>{renderMobileNav("home")}</div>
      </div>
    </div>
  );
}
