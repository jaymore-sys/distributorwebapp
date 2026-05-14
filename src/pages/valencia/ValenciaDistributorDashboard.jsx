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
import { getFirebaseServices } from "../../firebase";
import valenciaLogo from "../../assets/drink-valencia-logo.jpg";
import HistoryDateFilter, { getFilterLabel, getFilterHeading } from "../../components/HistoryDateFilter";
import "./valencia.css";

const { auth, db, storage } = getFirebaseServices("valencia");

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

function sanitizeGstInput(value) {
  return value.toUpperCase().replace(/[^0-9A-Z]/g, "").slice(0, 15);
}

function isValidIndianGst(value) {
  return /^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z0-9]Z[A-Z0-9]$/.test(value);
}

function getAvatarBg(index) {
  const list = [
    "#ef6a1d",
    "#f28c45",
    "#ea7a3a",
    "#d95d22",
    "#c94f18",
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

  const rows = (order?.items || [])
    .map((item, index) => {
      const qty = Number(item.quantity || 0);
      const rate = Number(item.rate || 0);
      const total = qty * rate;

      return `
        <tr>
          <td>${index + 1}</td>
          <td>${escapeHtml(item.name || "-")}</td>
          <td>${qty}</td>
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
            background:#fff7f2;
            margin:0;
            padding:24px;
            color:#3a2418;
          }
          .sheet{
            max-width:920px;
            margin:0 auto;
            background:#fff;
            border:1px solid #f2d7c8;
            border-radius:18px;
            overflow:hidden;
          }
          .head{
            background:#e46832;
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
            border-top:1px solid #f2d7c8;
          }
          .grid{
            display:grid;
            grid-template-columns:1fr 1fr;
            gap:18px;
          }
          .label{
            font-size:12px;
            color:#9b7462;
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
            border:1px solid #f2d7c8;
            padding:10px 12px;
            text-align:left;
            font-size:14px;
          }
          th{
            background:#fff4ed;
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
            border-bottom:1px solid #f2d7c8;
          }
          .grand{
            color:#e46832;
            font-size:18px;
            font-weight:800;
          }
        </style>
      </head>
      <body>
        <div class="sheet">
          <div class="head">
            <h1>Drink Valencia Invoice</h1>
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
                <div class="label">GST Number</div>
                <div class="value">${escapeHtml(order?.gst || "-")}</div>
              </div>
              <div>
                <div class="label">Sales Zone</div>
                <div class="value">${escapeHtml(order?.salesZone || "-")}</div>
              </div>
              <div>
                <div class="label">Distributor</div>
                <div class="value">${escapeHtml(order?.distributorName || "-")}</div>
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
                <span>Wholesale Discount</span>
                <span>- ${formatRupees(order?.wholesaleDiscount || 0)}</span>
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

const NAV_IDLE = "#9f8b82";
const NAV_ACTIVE = "#ef6a1d";
const BRAND_ACCENT = "#ef6a1d";
const BRAND_GRAD_FROM = "#ef6a1d";
const BRAND_GRAD_TO = "#ef6a1d";

function ThemeOverrides() {
  return (
    <style>{`
      .vld-primary-btn,
      .vld-review-btn {
        background: ${BRAND_ACCENT} !important;
        box-shadow: 0 10px 20px rgba(239,106,29,0.18) !important;
      }

      .vld-secondary-btn {
        border-color: ${BRAND_ACCENT} !important;
        color: ${BRAND_ACCENT} !important;
      }

      .vld-filter-row button.active,
      .vld-total-card,
      .vld-history-hero,
      .vld-sales-card,
      .vld-qty-row button,
      .vld-review-total {
        background: ${BRAND_ACCENT} !important;
        color: #fff !important;
      }

      .vld-sales-card h2,
      .vld-sales-card small,
      .vld-sales-card strong {
        color: #fff !important;
      }

      .vld-add-btn {
        background: ${BRAND_ACCENT} !important;
      }
      .vld-add-btn:disabled {
        background: ${BRAND_ACCENT}18 !important;
        color: ${BRAND_ACCENT} !important;
        border: 1.5px solid ${BRAND_ACCENT}40 !important;
      }

      .vld-bottom-nav button.active span {
        color: ${BRAND_ACCENT} !important;
      }

      .vld-bottom-nav button.active {
        color: ${BRAND_ACCENT} !important;
        background: ${BRAND_ACCENT}18 !important;
      }

      .vld-bottom-nav button.active svg path,
      .vld-bottom-nav button.active svg circle {
        stroke: ${BRAND_ACCENT} !important;
      }

      .vld-history-search input:focus,
      .vld-search-wrap input:focus,
      .vld-form-list input:focus,
      .vld-form-list select:focus {
        border-color: ${BRAND_ACCENT} !important;
        box-shadow: 0 0 0 3px rgba(228,104,50,0.08) !important;
      }

      .vld-success-actions .receipt {
        background: #fff1e8 !important;
        color: ${BRAND_ACCENT} !important;
      }

      .vld-section-head button {
        color: ${BRAND_ACCENT} !important;
      }

      .vld-success-icon {
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

export default function ValenciaDistributorDashboard() {
  const navigate = useNavigate();
  const fileInputRef = useRef(null);

  const [screen, setScreen] = useState("home");
  const [userProfile, setUserProfile] = useState(null);

  const [loadingProfile, setLoadingProfile] = useState(true);
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [loadingOrders, setLoadingOrders] = useState(true);
  const [submittingOrder, setSubmittingOrder] = useState(false);

  const [products, setProducts] = useState([]);
  const [orders, setOrders] = useState([]);
  const [lastOrder, setLastOrder] = useState(null);

  const [customer, setCustomer] = useState({
    shopName: "",
    phone: "",
    gst: "",
    zone: "",
  });

  const [customerError, setCustomerError] = useState("");
  const [search, setSearch] = useState("");
  const [historySearch, setHistorySearch] = useState("");
  const [historyFilter, setHistoryFilter] = useState("today");
  const [startDate, setStartDate] = useState(null);
  const [endDate, setEndDate] = useState(null);
  const [category, setCategory] = useState("all");
  const [cart, setCart] = useState({});
  const [selectedProductForOptions, setSelectedProductForOptions] = useState(null);
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

  useEffect(() => {
    let unsubscribeOrders = () => { };

    const unsubscribeAuth = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        setUserProfile(null);
        setOrders([]);
        setLoadingProfile(false);
        setLoadingOrders(false);
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

        setUserProfile(merged);
        setProfileForm({
          name: merged.name || "",
          businessName: merged.businessName || "",
          phone: merged.phone || "",
          territory: merged.territory || merged.zone || "West Region",
        });
        setProfilePreview(merged.profileImageUrl || "");

        unsubscribeOrders = onSnapshot(
          query(collection(db, "orders"), where("distributorUid", "==", user.uid)),
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
      } catch (error) {
        console.error("Profile fetch error:", error);
        setLoadingProfile(false);
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
      unsubscribeProducts();
    };
  }, []);

  const categoryTabs = useMemo(() => {
    const names = [...new Set(products.map((item) => (item.category || "").trim()).filter(Boolean))];
    return ["all", ...names];
  }, [products]);

  const filteredProducts = useMemo(() => {
    return products.filter((product) => {
      const categoryMatch =
        category === "all" || (product.category || "").toLowerCase() === category.toLowerCase();

      const searchMatch =
        !search.trim() || (product.name || "").toLowerCase().includes(search.toLowerCase());

      return categoryMatch && searchMatch;
    });
  }, [products, category, search]);

  const VALENCIA_OPTIONS = [
    { id: "1x250", label: "1 X 250 ml", count: 1 },
    { id: "4x250", label: "4 X 250 ml", count: 4 },
    { id: "6x250", label: "6 X 250 ml", count: 6 },
    { id: "12x250", label: "12 X 250 ml", count: 12 },
    { id: "24x250", label: "24 X 250 ml", count: 24 },
  ];

  const getTotalRemainingUnits = (stockData) =>
    VALENCIA_OPTIONS.reduce(
      (sum, opt) => sum + Number(stockData[`stock_${opt.id}`] || 0) * opt.count,
      0
    );

  const selectedProductForOptionsLive = useMemo(() => {
    if (!selectedProductForOptions) return null;
    return (
      products.find((product) => product.id === selectedProductForOptions.id) ||
      selectedProductForOptions
    );
  }, [products, selectedProductForOptions]);

  const selectedItems = useMemo(() => {
    const items = [];
    products.forEach((product) => {
      VALENCIA_OPTIONS.forEach((opt) => {
        const cartKey = `${product.id}_${opt.id}`;
        const qtyInCart = cart[cartKey] || 0;
        if (qtyInCart > 0) {
          const baseRate = Number(product.rate || product.price || 0);
          const itemRate = baseRate * opt.count;
          items.push({
            ...product,
            optionId: opt.id,
            optionLabel: opt.label,
            unitCount: opt.count,
            quantity: qtyInCart,
            lineTotal: qtyInCart * itemRate,
            rate: itemRate,
            rateLabel: `₹${itemRate.toFixed(2)} / ${opt.label}`,
          });
        }
      });
    });
    return items;
  }, [products, cart]);

  const totalUnits = selectedItems.reduce((sum, item) => sum + item.quantity * item.unitCount, 0);
  const subtotal = selectedItems.reduce((sum, item) => sum + item.lineTotal, 0);
  const wholesaleDiscount = subtotal * 0.05;
  const taxableValue = subtotal - wholesaleDiscount;
  const tax = taxableValue * 0.08;
  const totalSaleValue = taxableValue + tax;

  const { todayRevenue, todayUnits } = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    const todayOrders = orders.filter((o) => Number(o.createdAtMs || 0) >= d.getTime());
    return {
      todayRevenue: todayOrders.reduce((sum, item) => sum + Number(item.total || 0), 0),
      todayUnits: todayOrders.reduce((sum, item) => sum + Number(item.totalUnits || 0), 0),
    };
  }, [orders]);
  const recentActivity = orders.slice(0, 3);

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
      else if (historyFilter === "date" && startDate && endDate) {
        const selStart = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate()).getTime();
        const selEnd = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate()).getTime() + 86400000;
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
      setCustomerError("Please enter GST number.");
      return false;
    }

    if (!isValidIndianGst(customer.gst.trim())) {
      setCustomerError("Please enter a valid 15-character GST number.");
      return false;
    }

    if (!customer.zone.trim()) {
      setCustomerError("Please select sales zone.");
      return false;
    }

    setCustomerError("");
    return true;
  };

  const handleCustomerChange = (e) => {
    const { name, value } = e.target;
    let finalValue = value;

    if (name === "phone") finalValue = sanitizePhoneInput(value);
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
      navigate("/login?section=drinkvalencia", { replace: true });
    } catch (error) {
      console.error("Logout error:", error);
      setProfileMessage("Failed to logout.");
    }
  };

  const addToCart = (productId, optionId) => {
    const cartKey = `${productId}_${optionId}`;
    const product = products.find((item) => item.id === productId);
    const availableStock = Number(product?.[`stock_${optionId}`] || 0);

    setCart((prev) => {
      const currentQty = Number(prev[cartKey] || 0);
      if (availableStock <= 0 || currentQty >= availableStock) return prev;

      return {
        ...prev,
        [cartKey]: currentQty + 1,
      };
    });
  };

  const removeFromCart = (productId, optionId) => {
    const cartKey = `${productId}_${optionId}`;
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
      zone: "",
    });
    setCustomerError("");
    setCategory("all");
    setSearch("");
    setCart({});
    setLastOrder(null);
    setPendingSummaryAfterCustomer(false);
  };

  const startNewSale = () => {
    resetSaleFlow();
    setScreen("customer");
  };

  const moveToProducts = () => {
    if (!validateCustomerInputs()) return;

    if (pendingSummaryAfterCustomer) {
      setPendingSummaryAfterCustomer(false);
      setScreen("summary");
      return;
    }

    setScreen("products");
  };

  const moveToSummary = () => {
    if (!selectedItems.length) return;

    if (!validateCustomerInputs()) {
      setPendingSummaryAfterCustomer(true);
      setScreen("customer");
      return;
    }

    setScreen("summary");
  };

  const buildCurrentInvoiceData = () => ({
    invoiceNumber: `INV-PREVIEW-${Date.now()}`,
    distributorUid: userProfile?.uid || "",
    distributorName: userProfile?.name || auth.currentUser?.displayName || "Distributor",
    distributorId: userProfile?.distributorId || "",
    shopName: customer.shopName,
    phone: customer.phone,
    gst: customer.gst,
    salesZone: customer.zone,
    subtotal,
    wholesaleDiscount,
    tax,
    total: totalSaleValue,
    totalUnits,
    itemCount: selectedItems.length,
    items: selectedItems.map((item) => ({
      productId: item.id,
      name: item.name || "",
      category: item.category || "",
      quantity: item.quantity,
      unitCount: item.unitCount,
      unitLabel: item.unitLabel || "",
      optionId: item.optionId,
      optionLabel: item.optionLabel,
      rate: Number(item.rate || item.price || 0),
      lineTotal: item.lineTotal,
      imageUrl: item.imageUrl || item.image || "",
    })),
    createdAtMs: Date.now(),
    timeLabel: new Date().toLocaleString("en-IN", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }),
  });

  const handleDownloadCurrentInvoice = () => {
    if (!selectedItems.length) {
      alert("Please add items first.");
      return;
    }

    if (!validateCustomerInputs()) {
      setPendingSummaryAfterCustomer(true);
      setScreen("customer");
      return;
    }

    downloadInvoiceFile(buildCurrentInvoiceData());
  };

  const submitSale = async () => {
    if (!userProfile || !selectedItems.length) return;

    if (!validateCustomerInputs()) {
      setPendingSummaryAfterCustomer(true);
      setScreen("customer");
      return;
    }

    try {
      setSubmittingOrder(true);

      const now = new Date();
      const createdAtMs = Date.now();
      const invoiceNumber = `INV-${createdAtMs}`;

      const orderPayload = {
        brand: "drinkvalencia",
        invoiceNumber,
        distributorUid: userProfile.uid,
        distributorName: userProfile.name || auth.currentUser?.displayName || "Distributor",
        distributorId: userProfile.distributorId || "",
        shopName: customer.shopName,
        phone: customer.phone,
        gst: customer.gst,
        salesZone: customer.zone,
        subtotal,
        wholesaleDiscount,
        tax,
        total: totalSaleValue,
        totalUnits,
        itemCount: selectedItems.length,
        items: selectedItems.map((item) => ({
          productId: item.id,
          name: item.name || "",
          category: item.category || "",
          optionId: item.optionId,
          optionLabel: item.optionLabel,
          quantity: item.quantity,
          unitCount: item.unitCount,
          unitLabel: item.unitLabel || "",
          rate: Number(item.rate || item.price || 0),
          rateLabel: `₹${Number(item.rate || item.price || 0).toFixed(2)} / ${item.optionLabel}`,
          lineTotal: item.lineTotal,
          imageUrl: item.imageUrl || item.image || "",
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

      const orderRef = doc(collection(db, "orders"));
      const stockRequestsByProduct = selectedItems.reduce((map, item) => {
        const productId = item.id;
        const existing = map.get(productId) || {
          productRef: doc(db, "products", productId),
          requests: [],
        };

        existing.requests.push({
          name: item.name || "Product",
          optionLabel: item.optionLabel || item.optionId,
          stockKey: `stock_${item.optionId}`,
          quantity: Number(item.quantity || 0),
        });
        map.set(productId, existing);
        return map;
      }, new Map());

      await runTransaction(db, async (transaction) => {
        const productSnapshots = [];

        for (const { productRef, requests } of stockRequestsByProduct.values()) {
          const productSnap = await transaction.get(productRef);
          productSnapshots.push({ productRef, requests, productSnap });
        }

        for (const { productRef, requests, productSnap } of productSnapshots) {
          if (!productSnap.exists()) {
            throw new Error(`${requests[0]?.name || "Product"} is no longer available.`);
          }

          const currentData = productSnap.data();
          const nextData = { ...currentData };
          const updateData = {};

          requests.forEach((request) => {
            const currentStock = Number(nextData[request.stockKey] || 0);
            if (currentStock < request.quantity) {
              throw new Error(
                `Only ${currentStock} left for ${request.name} (${request.optionLabel}).`
              );
            }

            const nextStock = currentStock - request.quantity;
            nextData[request.stockKey] = nextStock;
            updateData[request.stockKey] = nextStock;
          });

          updateData.stock = getTotalRemainingUnits(nextData);
          transaction.update(productRef, updateData);
        }

        transaction.set(orderRef, orderPayload);
      });

      setLastOrder({
        id: orderRef.id,
        ...orderPayload,
      });

      setScreen("success");
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

    const text = `Hello ${lastOrder.shopName || ""}, your Drink Valencia order ${lastOrder.invoiceNumber || ""
      } of ${formatRupees(lastOrder.total || 0)} has been recorded successfully.`;

    const url = `https://wa.me/${lastOrder.phone || ""}?text=${encodeURIComponent(text)}`;
    window.open(url, "_blank");
  };

  const renderProductVisual = (product) => {
    const imageSrc = product.imageUrl || product.image || "";
    if (imageSrc) {
      return <img src={imageSrc} alt={product.name} className="vld-product-image" />;
    }

    return (
      <div className="vld-product-fallback">
        <span>{product.name}</span>
      </div>
    );
  };

  const renderMobileNav = (active) => (
    <div
      className="vld-bottom-nav"
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
        onClick={() => setScreen("home")}
      >
        <DashboardNavIcon type="home" active={active === "home"} />
        <span>Home</span>
      </button>

      <button
        type="button"
        className={active === "products" ? "active" : ""}
        onClick={() => setScreen("products")}
      >
        <DashboardNavIcon type="products" active={active === "products"} />
        <span>Inventory</span>
      </button>

      <button
        type="button"
        className={active === "history" ? "active" : ""}
        onClick={() => setScreen("history")}
      >
        <DashboardNavIcon type="history" active={active === "history"} />
        <span>Orders</span>
      </button>

      <button
        type="button"
        className={active === "profile" ? "active" : ""}
        onClick={() => setScreen("profile")}
      >
        <DashboardNavIcon type="profile" active={active === "profile"} />
        <span>Profile</span>
      </button>
    </div>
  );

  if (loadingProfile || loadingProducts || loadingOrders) {
    return (
      <div className="vld-page">
        <ThemeOverrides />
        <div className="vld-shell vld-shell-light">
          <div style={{ padding: "40px 0", textAlign: "center", color: "#7d879b" }}>
            Loading Drink Valencia distributor data...
          </div>
        </div>
      </div>
    );
  }

  if (!userProfile) {
    return (
      <div className="vld-page">
        <ThemeOverrides />
        <div className="vld-shell vld-shell-light">
          <div style={{ padding: "40px 0", textAlign: "center", color: "#7d879b" }}>
            Please log in again to continue.
          </div>
        </div>
      </div>
    );
  }

  if (screen === "profile") {
    return (
      <div className="vld-page">
        <ThemeOverrides />
        <div
          className="vld-shell vld-shell-light"
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
                      background: "linear-gradient(180deg,#ffb67d 0%,#e46832 100%)",
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
              {profileForm.name || "Distributor"}
            </h2>

            <p
              style={{
                margin: 0,
                textAlign: "center",
                color: "#7d879b",
                fontSize: 13,
              }}
            >
              Sales Executive • {profileForm.territory || "West Region"}
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
                    placeholder="e.g. West Region"
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
                        territory: userProfile?.territory || userProfile?.zone || "West Region",
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
                  setScreen("history");
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
                  <small style={{ color: "#7d879b" }}>Total Sales</small>
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
                  onClick={() => setScreen("products")}
                  accent={BRAND_ACCENT}
                />
                <ProfileMenuRow
                  icon="🧾"
                  title="My Sales History"
                  subtitle="Track your closed deals"
                  onClick={() => setScreen("history")}
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
              onClick={handleLogout}
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
                boxShadow: "0 10px 20px rgba(228,104,50,0.18)",
              }}
            >
              Logout Account
            </button>
          </div>

          <div style={{ flexShrink: 0, background: "#fff" }}>{renderMobileNav("profile")}</div>
        </div>
      </div>
    );
  }

  if (screen === "customer") {
    return (
      <div className="vld-page">
        <ThemeOverrides />
        <div className="vld-shell vld-shell-light">
          <div className="vld-topbar-step">
            <button type="button" className="vld-back-btn" onClick={() => setScreen("home")}>
              ←
            </button>
            <h2>New Sale</h2>
            <span className="vld-top-placeholder" />
          </div>

          <div className="vld-step-content">
            <h1>Customer Details</h1>
            <p>Step 1 of 3: Enter the shop's basic information.</p>

            <div className="vld-form-list">
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
                <span>GST Number</span>
                <input
                  type="text"
                  name="gst"
                  maxLength={15}
                  value={customer.gst}
                  onChange={handleCustomerChange}
                  placeholder="22AAAAA0000A1Z5"
                />
              </label>

              <label>
                <span>Sales Zone</span>
                <select name="zone" value={customer.zone} onChange={handleCustomerChange}>
                  <option value="">Select a zone</option>
                  <option value="North">North</option>
                  <option value="South">South</option>
                  <option value="East">East</option>
                  <option value="West">West</option>
                  <option value="Central">Central</option>
                </select>
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

          <div className="vld-step-footer">
            <button
              type="button"
              className="vld-primary-btn"
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
      <div className="vld-page">
        <ThemeOverrides />
        <div
          className="vld-shell vld-shell-light"
          style={{
            display: "flex",
            flexDirection: "column",
            minHeight: "100vh",
            overflow: "hidden",
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
            <div className="vld-topbar-step">
              <button type="button" className="vld-back-btn" onClick={() => setScreen("customer")}>
                ←
              </button>

              <div className="vld-step-center">
                <small>STEP 2 OF 4</small>
                <h2>Product Selection</h2>
              </div>

              <div className="vld-top-placeholder" />
            </div>

            <div className="vld-search-wrap" style={{ padding: "0 16px" }}>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search SKU or product name"
              />
            </div>

            <div className="vld-filter-row" style={{ padding: "0 16px", marginTop: 8 }}>
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
              <div className="vld-empty-card">
                No products available. Please ask admin to upload products first.
              </div>
            ) : (
              <div className="vld-product-grid">
                {filteredProducts.map((product) => {
                  const productInCart = selectedItems.filter(si => si.id === product.id);
                  const totalProductQty = productInCart.reduce((s, i) => s + i.quantity, 0);
                  const isOutOfStock = VALENCIA_OPTIONS.every(opt => Number(product[`stock_${opt.id}`] || 0) <= 0);

                  return (
                    <div className="vld-product-card" key={product.id} style={{ opacity: isOutOfStock ? 0.6 : 1 }}>
                      <div className="vld-product-thumb">{renderProductVisual(product)}</div>

                      <div className="vld-product-meta">
                        <h4>{product.name}</h4>
                        <p>{product.description || product.category || "-"}</p>
                        {isOutOfStock && (
                          <div style={{ marginTop: 4, color: "#ff4d4f", fontSize: 10, fontWeight: 700, textTransform: "uppercase" }}>
                            Out of Stock
                          </div>
                        )}
                      </div>

                      <button
                        type="button"
                        className="vld-add-btn vld-add-with-options"
                        onClick={() => setSelectedProductForOptions(product)}
                        disabled={isOutOfStock}
                        style={isOutOfStock ? { background: "#aab2bd", cursor: "not-allowed" } : {}}
                      >
                        {isOutOfStock ? (
                          <span>OUT OF STOCK</span>
                        ) : totalProductQty > 0 ? (
                          <>
                            <span>ADD</span>
                            <small>{totalProductQty} Selected</small>
                          </>
                        ) : (
                          <>
                            <span>ADD</span>
                            <small>5 Options</small>
                          </>
                        )}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {selectedProductForOptionsLive && (
            <div className="vld-options-overlay">
              <div className="vld-options-sheet">
                <button
                  className="vld-options-close"
                  onClick={() => setSelectedProductForOptions(null)}
                >
                  ✕
                </button>

                <div className="vld-options-header" style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 16 }}>
                  <button
                    type="button"
                    className="vld-back-btn"
                    onClick={() => setSelectedProductForOptions(null)}
                    style={{ padding: 0, width: 24, height: 24, display: "flex", alignItems: "center", justifyContent: "center", marginTop: -2 }}
                  >
                    ←
                  </button>
                  <div>
                    <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, textTransform: "uppercase" }}>
                      {selectedProductForOptionsLive.name}
                    </h3>
                    <p style={{ margin: 0, fontSize: 13, color: "#7d879b" }}>
                      {selectedProductForOptionsLive.description || "250 ml"}
                    </p>
                  </div>
                </div>

                <div className="vld-options-list">
                  {VALENCIA_OPTIONS.map((opt) => {
                    const cartKey = `${selectedProductForOptionsLive.id}_${opt.id}`;
                    const qty = cart[cartKey] || 0;
                    const baseRate = Number(selectedProductForOptionsLive.rate || selectedProductForOptionsLive.price || 0);
                    const itemPrice = baseRate * opt.count;
                    const stockKey = `stock_${opt.id}`;
                    const availableStock = Number(selectedProductForOptionsLive[stockKey] || 0);

                    return (
                      <div className="vld-option-row" key={opt.id}>
                        <div className="vld-option-thumb">
                          {renderProductVisual(selectedProductForOptionsLive)}
                        </div>
                        <div className="vld-option-info">
                          <span className="vld-option-label">{opt.label}</span>
                          <span className="vld-option-price">₹{itemPrice}</span>
                          <div style={{ fontSize: 10, color: availableStock <= 0 ? "#ff4d4f" : "#52c41a", fontWeight: 600 }}>
                            {availableStock > 0 ? `In Stock: ${availableStock}` : "Out of Stock"}
                          </div>
                        </div>

                        {qty > 0 ? (
                          <div className="vld-option-qty">
                            <button onClick={() => removeFromCart(selectedProductForOptionsLive.id, opt.id)}>−</button>
                            <span>{qty}</span>
                            <button
                              onClick={() => addToCart(selectedProductForOptionsLive.id, opt.id)}
                              disabled={qty >= availableStock}
                            >+</button>
                          </div>
                        ) : (
                          <button
                            className="vld-option-add"
                            onClick={() => addToCart(selectedProductForOptionsLive.id, opt.id)}
                            disabled={availableStock <= 0}
                          >
                            ADD
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>

                <div className="vld-options-footer">
                  <div className="vld-options-footer-total">
                    <small>{totalUnits} ITEMS SELECTED</small>
                    <strong>{formatRupees(subtotal)} Total</strong>
                  </div>
                  <button
                    className="vld-options-review-btn"
                    onClick={() => {
                      setSelectedProductForOptions(null);
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
              <div className="vld-review-total">
                <small>{totalUnits} ITEMS SELECTED</small>
                <strong>{formatRupees(subtotal)} Total</strong>
              </div>

              <button
                type="button"
                className="vld-review-btn"
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
      <div className="vld-page">
        <ThemeOverrides />
        <div className="vld-shell vld-shell-light">
          <div className="vld-topbar-step">
            <button type="button" className="vld-back-btn" onClick={() => setScreen("products")}>
              ←
            </button>
            <h2>Order Summary</h2>
            <span className="vld-top-placeholder" />
          </div>

          <div className="vld-progress-row">
            <span />
            <span />
            <span className="active" />
          </div>

          <div className="vld-summary-block">
            <h3>Review Products</h3>
            <p>{selectedItems.length} items in your cart</p>

            <div className="vld-summary-list">
              {selectedItems.map((item) => (
                <div className="vld-summary-item" key={`${item.id}_${item.optionId}`}>
                  <div className="vld-summary-thumb">
                    {item.imageUrl || item.image ? (
                      <img src={item.imageUrl || item.image} alt={item.name} />
                    ) : (
                      <div className="vld-summary-fallback">{item.name}</div>
                    )}
                  </div>

                  <div className="vld-summary-copy">
                    <h4>{item.name}</h4>
                    <p>{item.optionLabel} • Qty: {item.quantity}</p>
                    <small>{item.rateLabel}</small>
                  </div>

                  <strong>{formatRupees(item.lineTotal)}</strong>
                </div>
              ))}
            </div>
          </div>

          <div className="vld-order-card">
            <h3>Order Details</h3>

            <div className="vld-order-rows">
              <div>
                <span>Subtotal</span>
                <strong>{formatRupees(subtotal)}</strong>
              </div>
              <div>
                <span>Wholesale Discount (5%)</span>
                <strong className="green">-{formatRupees(wholesaleDiscount)}</strong>
              </div>
              <div>
                <span>Tax (8%)</span>
                <strong>{formatRupees(tax)}</strong>
              </div>
            </div>
          </div>

          <div className="vld-total-card">
            <div>
              <small>TOTAL SALE VALUE</small>
              <strong>{formatRupees(totalSaleValue)}</strong>
            </div>
          </div>

          <button
            type="button"
            className="vld-primary-btn"
            onClick={submitSale}
            disabled={submittingOrder}
          >
            {submittingOrder ? "Submitting..." : "Submit Sale ▷"}
          </button>
        </div>
      </div>
    );
  }

  if (screen === "success") {
    return (
      <div className="vld-page">
        <ThemeOverrides />
        <div className="vld-shell vld-shell-light">
          <div className="vld-topbar-step">
            <button type="button" className="vld-back-btn" onClick={() => setScreen("home")}>
              ←
            </button>
            <h2>Sale Confirmation</h2>
            <span className="vld-top-placeholder" />
          </div>

          <div className="vld-success-wrap">
            <div className="vld-success-icon">✓</div>
            <h1>Sale Recorded Successfully!</h1>
            <p>
              Your transaction has been processed and added to
              <br />
              the daily ledger.
            </p>

            <div className="vld-success-card">
              <div className="vld-success-shop">
                <div className="vld-shop-thumb">🏪</div>
                <div>
                  <small>SHOP NAME</small>
                  <h3>{lastOrder?.shopName || "-"}</h3>
                </div>
              </div>

              <div className="vld-success-divider" />

              <div className="vld-success-total">
                <div>
                  <small>TOTAL VALUE</small>
                  <strong>{formatRupees(lastOrder?.total || 0)}</strong>
                </div>

                <div className="vld-success-actions">
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
            className="vld-secondary-btn"
            onClick={() => downloadInvoiceFile(lastOrder)}
            style={{ marginBottom: 12 }}
          >
            Download Invoice
          </button>

          <button type="button" className="vld-primary-btn" onClick={startNewSale}>
            Log Another Sale
          </button>

          <button type="button" className="vld-secondary-btn" onClick={() => setScreen("home")}>
            Back to Home
          </button>
        </div>
      </div>
    );
  }

  if (screen === "history") {
    return (
      <div className="vld-page">
        <ThemeOverrides />
        <div
          className="vld-shell vld-shell-light"
          style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}
        >
          <div style={{ flex: 1, overflowY: "auto" }}>
            <div className="vld-topbar-step">
              <button type="button" className="vld-back-btn" onClick={() => setScreen("home")}>
                ←
              </button>
              <h2>Daily Sales History</h2>
              <span className="vld-top-placeholder" />
            </div>

            <div className="vld-history-hero">
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
              accentColor="#ef6a1d"
              cssPrefix="vld"
            />

            <div className="vld-search-wrap vld-history-search">
              <input
                placeholder="Search shop name, ID..."
                value={historySearch}
                onChange={(e) => setHistorySearch(e.target.value)}
              />
            </div>

            <div className="vld-history-day">
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
                No sales recorded yet.
              </div>
            ) : (
              <div className="vld-history-list">
                {filteredOrders.map((item, index) => (
                  <div className="vld-history-row" key={item.id}>
                    <div
                      className="vld-history-avatar"
                      style={{ background: getAvatarBg(index) }}
                    >
                      {item.shopName?.charAt(0) || "S"}
                    </div>

                    <div className="vld-history-copy">
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

  return (
    <div className="vld-page">
      <ThemeOverrides />
      <div
        className="vld-shell vld-shell-home"
        style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}
      >
        <div style={{ flex: 1, overflowY: "auto" }}>
          <div className="vld-home-topbar">
            <div className="vld-home-left">
              <div className="vld-user-avatar">
                {(userProfile?.name || "D").charAt(0).toUpperCase()}
              </div>
              <div>
                <h3>Dashboard</h3>
                <p>Welcome back, {(userProfile?.name || "Distributor").toUpperCase()}</p>
              </div>
            </div>

            <div className="vld-home-right">
              <button type="button" className="vld-bell-btn">🔔</button>
              <img src={valenciaLogo} alt="Drink Valencia" className="vld-header-logo" />
            </div>
          </div>

          <div className="vld-hero-block">
            <h1>Ready to sell?</h1>
            <p>Log a new transaction immediately.</p>
            <img src={valenciaLogo} alt="Drink Valencia" className="vld-hero-logo" />

            <button type="button" className="vld-primary-btn" onClick={startNewSale}>
              ⊕ New Sale
            </button>
          </div>

          <div className="vld-sales-card">
            <div className="vld-sales-head">
              <h2>Sales Today</h2>
              <span>{orders.length ? "Live data" : "No sales yet"}</span>
            </div>

            <div className="vld-sales-grid">
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

          <div className="vld-section-head">
            <h2>Recent Activity</h2>
            <button type="button" onClick={() => setScreen("history")}>
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
            <div className="vld-activity-list">
              {recentActivity.map((item, index) => (
                <div className="vld-activity-card" key={item.id}>
                  <div
                    className={`vld-activity-icon ${index % 3 === 0 ? "red" : index % 3 === 1 ? "orange" : "purple"
                      }`}
                  >
                    🏪
                  </div>

                  <div className="vld-activity-copy">
                    <h4>{item.shopName}</h4>
                    <p>{item.timeLabel || "-"}</p>
                  </div>

                  <div className="vld-activity-right">
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
