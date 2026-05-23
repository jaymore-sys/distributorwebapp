import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { onAuthStateChanged, signOut } from "firebase/auth";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import bounceLogo from "../../assets/9aaf616a1f05b52baba7f0d12dcc6600408fd0e3 (1).png";
import { getFirebaseServices } from "../../firebase";
import HistoryDateFilter, { getFilterLabel, getFilterHeading } from "../../components/HistoryDateFilter";
import { routeToChooseSelection, usePortalHistoryManager } from "../../navigation/globalNavigationManager";
import "./bounce.css";

const { auth, db, storage } = getFirebaseServices("bounce");

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

function sanitizePincodeInput(value) {
  return value.replace(/\D/g, "").slice(0, 6);
}

function sanitizeGstInput(value) {
  return value.toUpperCase().replace(/[^0-9A-Z]/g, "").slice(0, 15);
}

function isValidIndianGst(value) {
  return /^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z0-9]Z[A-Z0-9]$/.test(value);
}

function getAvatarBg(index) {
  const list = [
    "linear-gradient(180deg, #9fe1ff 0%, #53b6e2 100%)",
    "linear-gradient(180deg, #baeaff 0%, #6ec5ec 100%)",
    "linear-gradient(180deg, #8ad8fb 0%, #47a6d1 100%)",
    "linear-gradient(180deg, #d2f1ff 0%, #9bcfe7 100%)",
    "linear-gradient(180deg, #a7e6ff 0%, #59bce8 100%)",
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
            background:#53b6e2;
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
            color:#53b6e2;
            font-size:18px;
            font-weight:800;
          }
        </style>
      </head>
      <body>
        <div class="sheet">
          <div class="head">
            <h1>Bounce Invoice</h1>
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
                <div class="label">Sales Pincode</div>
                <div class="value">${escapeHtml(order?.salesPincode || order?.pincode || order?.salesZone || "-")}</div>
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

const NAV_IDLE = "#8491a7";
const NAV_ACTIVE = "#53b6e2";
const BRAND_ACCENT = "#53b6e2";
const BRAND_GRAD_FROM = "#7cd1f9";
const BRAND_GRAD_TO = "#53b6e2";

function ThemeOverrides() {
  return (
    <style>{`
      [data-brand="bounce"] .bzd-primary-btn,
      [data-brand="bounce"] .bzd-review-btn {
        background: linear-gradient(180deg, ${BRAND_GRAD_FROM} 0%, ${BRAND_GRAD_TO} 100%) !important;
        box-shadow: 0 10px 20px rgba(83,182,226,0.18) !important;
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

export default function BounceDistributorDashboard() {
  const navigate = useNavigate();
  const fileInputRef = useRef(null);

  const [screen, setScreen] = useState("home");
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
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
    portalKey: "bounce-distributor",
    basePath: "/bounce/distributor",
    rootScreen: "home",
    currentScreen: screen,
    setScreen,
  });

  useEffect(() => {
    setShowLogoutConfirm(false);
  }, [screen]);

  useEffect(() => {
    let unsubscribeOrders = () => { };

    const unsubscribeAuth = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        setUserProfile(null);
        setOrders([]);
        setLoadingProfile(false);
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

        setUserProfile(merged);
        setProfileForm({
          name: merged.name || "",
          businessName: merged.businessName || "",
          phone: merged.phone || "",
          territory: merged.territory || merged.zone || "North Region",
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
  }, [navigate]);

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

  const selectedItems = useMemo(() => {
    return products
      .filter((item) => cart[item.id] > 0)
      .map((item) => {
        const rate = Number(item.rate || 0);
        const quantity = cart[item.id];

        return {
          ...item,
          quantity,
          lineTotal: quantity * rate,
          rateLabel: `₹${rate.toFixed(2)} / Unit`,
        };
      });
  }, [products, cart]);

  const totalUnits = selectedItems.reduce((sum, item) => sum + item.quantity, 0);
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

  const addToCart = (productId) => {
    const product = products.find((p) => p.id === productId);
    const availableStock = Number(product?.stock || 0);
    const currentQty = cart[productId] || 0;

    if (currentQty >= availableStock) {
      return;
    }

    setCart((prev) => ({
      ...prev,
      [productId]: currentQty + 1,
    }));
  };

  const removeFromCart = (productId) => {
    setCart((prev) => {
      const next = { ...prev };
      const current = next[productId] || 0;

      if (current <= 1) {
        delete next[productId];
      } else {
        next[productId] = current - 1;
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
    distributorUid: userProfile?.uid || "",
    distributorName: userProfile?.name || auth.currentUser?.displayName || "Distributor",
    distributorId: userProfile?.distributorId || "",
    shopName: customer.shopName,
    phone: customer.phone,
    gst: customer.gst,
    salesPincode: customer.pincode,
    pincode: customer.pincode,
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
      unitLabel: item.unitLabel || "",
      rate: Number(item.rate || 0),
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
        distributorUid: userProfile.uid,
        distributorName: userProfile.name || auth.currentUser?.displayName || "Distributor",
        distributorId: userProfile.distributorId || "",
        shopName: customer.shopName,
        phone: customer.phone,
        gst: customer.gst,
        salesPincode: customer.pincode,
        pincode: customer.pincode,
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
          unitLabel: item.unitLabel || "",
          rate: Number(item.rate || 0),
          rateLabel: `₹${Number(item.rate || 0).toFixed(2)} / Unit`,
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

      // 1. Save the Order
      let savedRef;
      try {
        savedRef = await addDoc(collection(db, "orders"), orderPayload);
      } catch (err) {
        console.error("Order Creation Error:", err);
        throw new Error(`Order creation failed: ${err.message}`);
      }

      // 2. Update Stock (best-effort - distributor may lack write access to products)
      try {
        for (const item of selectedItems) {
          const productRef = doc(db, "products", item.id);
          const productSnap = await getDoc(productRef);
          if (productSnap.exists()) {
            const currentStock = Number(productSnap.data().stock || 0);
            const nextStock = Math.max(0, currentStock - item.quantity);
            await updateDoc(productRef, { stock: nextStock });
          }
        }
      } catch (err) {
        console.warn("Stock sync skipped (permissions):", err.message);
      }

      setLastOrder({
        id: savedRef.id,
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

    const text = `Hello ${lastOrder.shopName || ""}, your Bounce order ${lastOrder.invoiceNumber || ""
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

  if (loadingProfile || loadingProducts || loadingOrders) {
    return (
      <div className="bzd-page" data-brand="bounce">
        <ThemeOverrides />
        <div className="bzd-shell bzd-shell-light">
          <div style={{ padding: "40px 0", textAlign: "center", color: "#7d879b" }}>
            Loading Bounce distributor data...
          </div>
        </div>
      </div>
    );
  }

  if (!userProfile) {
    return (
      <div className="bzd-page" data-brand="bounce">
        <ThemeOverrides />
        <div className="bzd-shell bzd-shell-light">
          <div style={{ padding: "40px 0", textAlign: "center", color: "#7d879b" }}>
            Please log in again to continue.
          </div>
        </div>
      </div>
    );
  }

  let content = null;

  if (screen === "profile") {
    content = (
      <div className="bzd-shell bzd-shell-light" style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>
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

          <h2 style={{ margin: "12px 0 2px", textAlign: "center", fontSize: 28, fontWeight: 800, color: "#20263a" }}>
            {profileForm.name || "Distributor"}
          </h2>

          <p style={{ margin: 0, textAlign: "center", color: "#7d879b", fontSize: 13 }}>
            Sales Executive • {profileForm.territory || "North Region"}
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
                border: `1px solid ${profileMessage.includes("successfully") ? "#d7f0dc" : "#ffd1d1"}`,
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

          <div style={{ marginTop: 22, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
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
            <div style={{ background: "#fff", border: "1px solid #ececec", borderRadius: 16, padding: 14 }}>
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

            <div style={{ background: "#fff", border: "1px solid #ececec", borderRadius: 16, padding: 14 }}>
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
                title="My Sales History"
                subtitle="Track your closed deals"
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
              boxShadow: "0 10px 20px rgba(83,182,226,0.18)",
            }}
          >
            Logout Account
          </button>
        </div>

        <div style={{ flexShrink: 0, background: "#fff" }}>{renderMobileNav("profile")}</div>
      </div>
    );
  } else if (screen === "customer") {
    content = (
      <div className="bzd-shell bzd-shell-light">
        <div className="bzd-topbar-step">
          <button type="button" className="bzd-back-btn" onClick={() => goToScreen("home")}>
            ←
          </button>
          <h2>New Sale</h2>
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
    );
  } else if (screen === "products") {
    content = (
      <div className="bzd-shell bzd-shell-light" style={{ display: "flex", flexDirection: "column", minHeight: "100vh", overflow: "hidden" }}>
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", paddingBottom: 14 }}>
          <div className="bzd-topbar-step">
            <button type="button" className="bzd-back-btn" onClick={() => goToScreen("customer")}>
              ←
            </button>

            <div className="bzd-step-center">
              <small>STEP 2 OF 4</small>
              <h2>Product Selection</h2>
            </div>

            <button type="button" className="bzd-info-btn">
              i
            </button>
          </div>

          <div className="bzd-search-wrap">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search SKU or product name"
            />
          </div>

          <div className="bzd-filter-row">
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
            <div style={{ background: "#fff", border: "1px solid #ececec", borderRadius: "18px", padding: "20px", textAlign: "center", color: "#7d879b", marginBottom: 10 }}>
              No products available. Please ask admin to upload products first.
            </div>
          ) : (
            <div className="bzd-product-grid">
              {filteredProducts.map((product) => {
                const qty = cart[product.id] || 0;
                const productPrice = Number(product.rate || product.price || 0);

                return (
                  <div className="bzd-product-card" key={product.id}>
                    <div className="bzd-product-thumb">{renderProductVisual(product)}</div>

                    <div className="bzd-product-meta">
                      <h4>{product.name}</h4>
                      <strong className="bzd-product-price">
                        {productPrice > 0 ? formatRupees(productPrice) : "Price not set"}
                      </strong>
                      <small style={{ color: Number(product.stock || 0) <= 0 ? BRAND_ACCENT : "#7d879b", fontWeight: 700 }}>
                        {Number(product.stock || 0) <= 0 ? "OUT OF STOCK" : `${product.stock} Units Available`}
                      </small>
                      <p>{product.description || product.category || "-"}</p>
                    </div>

                    {qty > 0 ? (
                      <div className="bzd-qty-row">
                        <button type="button" onClick={() => removeFromCart(product.id)}>
                          −
                        </button>
                        <span>{qty}</span>
                        <button
                          type="button"
                          onClick={() => addToCart(product.id)}
                          disabled={qty >= Number(product.stock || 0)}
                        >
                          +
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="bzd-add-btn"
                        onClick={() => addToCart(product.id)}
                        disabled={Number(product.stock || 0) <= 0}
                      >
                        {Number(product.stock || 0) <= 0 ? "SOLD OUT" : "ADD"}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div style={{ flexShrink: 0, background: "#fff", borderTop: "1px solid #ececec", boxShadow: "0 -8px 18px rgba(0,0,0,0.04)" }}>
          <div style={{ padding: "10px 14px 10px", display: "grid", gridTemplateColumns: "1fr 0.95fr", gap: 12 }}>
            <div className="bzd-review-total">
              <small>{totalUnits} ITEMS SELECTED</small>
              <strong>{formatRupees(subtotal)} Total</strong>
            </div>

            <button
              type="button"
              className="bzd-review-btn"
              disabled={!selectedItems.length}
              onClick={moveToSummary}
            >
              Review Order →
            </button>
          </div>

          {renderMobileNav("products")}
        </div>
      </div>
    );
  } else if (screen === "summary") {
    content = (
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
                  <p>Qty: {item.quantity} Pcs</p>
                  <small>{item.rateLabel}</small>
                </div>

                <strong>{formatRupees(item.lineTotal)}</strong>
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
              <span>Wholesale Discount (5%)</span>
              <strong className="green">-{formatRupees(wholesaleDiscount)}</strong>
            </div>
            <div>
              <span>Tax (8%)</span>
              <strong>{formatRupees(tax)}</strong>
            </div>
          </div>
        </div>

        <div className="bzd-total-card">
          <div>
            <small>TOTAL SALE VALUE</small>
            <strong>{formatRupees(totalSaleValue)}</strong>
          </div>
        </div>

        <button
          type="button"
          className="bzd-primary-btn"
          onClick={submitSale}
          disabled={submittingOrder}
        >
          {submittingOrder ? "Submitting..." : "Submit Sale ▷"}
        </button>
      </div>
    );
  } else if (screen === "success") {
    content = (
      <div className="bzd-shell bzd-shell-light">
        <div className="bzd-topbar-step">
          <button type="button" className="bzd-back-btn" onClick={() => goToScreen("home")}>
            ←
          </button>
          <h2>Sale Confirmation</h2>
          <span className="bzd-top-placeholder" />
        </div>

        <div className="bzd-success-wrap">
          <div className="bzd-success-icon">✓</div>
          <h1>Sale Recorded Successfully!</h1>
          <p>Your transaction has been processed and added to<br />the daily ledger.</p>

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

        <button type="button" className="bzd-secondary-btn" onClick={() => downloadInvoiceFile(lastOrder)} style={{ marginBottom: 12 }}>
          Download Invoice
        </button>

        <button type="button" className="bzd-primary-btn" onClick={startNewSale}>
          Log Another Sale
        </button>

        <button type="button" className="bzd-secondary-btn" onClick={() => goToScreen("home")}>
          Back to Home
        </button>
      </div>
    );
  } else if (screen === "history") {
    content = (
      <div className="bzd-shell bzd-shell-light" style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>
        <div style={{ flex: 1, overflowY: "auto" }}>
          <div className="bzd-topbar-step">
            <button type="button" className="bzd-back-btn" onClick={() => goToScreen("home")}>
              ←
            </button>
            <h2>Daily Sales History</h2>
            <span className="bzd-top-placeholder" />
          </div>

          <div className="bzd-history-hero">
            <small>{getFilterLabel(historyFilter, startDate, endDate)}</small>
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
            accentColor="#53b6e2"
            cssPrefix="bzd"
          />

          <div className="bzd-search-wrap bzd-history-search">
            <input
              placeholder="Search shop name, ID..."
              value={historySearch}
              onChange={(e) => setHistorySearch(e.target.value)}
            />
          </div>

          <div className="bzd-history-day">{getFilterHeading(historyFilter, startDate, endDate)}</div>

          {!filteredOrders.length ? (
            <div style={{ background: "#fff", border: "1px solid #ececec", borderRadius: "18px", padding: "20px", textAlign: "center", color: "#7d879b" }}>
              No sales recorded yet.
            </div>
          ) : (
            <div className="bzd-history-list">
              {filteredOrders.map((item, index) => (
                <div className="bzd-history-row" key={item.id}>
                  <div className="bzd-history-avatar" style={{ background: getAvatarBg(index) }}>
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
    );
  } else {
    // home screen
    content = (
      <div className="bzd-shell bzd-shell-home" style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>
        <div style={{ flex: 1, overflowY: "auto" }}>
          <div className="bzd-home-topbar">
            <div className="bzd-home-left">
              <button
                type="button"
                className="bzd-user-avatar"
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
                <p>Welcome back, {(userProfile?.name || "Distributor").toUpperCase()}</p>
              </div>
            </div>

            <div className="bzd-home-right">
              <button type="button" className="bzd-bell-btn">🔔</button>
              <img src={bounceLogo} alt="Bounce" className="bzd-header-logo" />
            </div>
          </div>

          <div className="bzd-hero-block">
            <h1>Ready to sell?</h1>
            <p>Log a new transaction immediately.</p>
            <img src={bounceLogo} alt="Bounce" className="bzd-hero-logo" />
            <button type="button" className="bzd-primary-btn" onClick={startNewSale}>⊕ New Sale</button>
          </div>

          <div className="bzd-sales-card">
            <div className="bzd-sales-head">
              <h2>Sales Today</h2>
              <span>{orders.length ? "Live data" : "No sales yet"}</span>
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
            <button type="button" onClick={() => goToScreen("history")}>View All</button>
          </div>

          {!recentActivity.length ? (
            <div style={{ background: "#fff", border: "1px solid #ececec", borderRadius: "18px", padding: "20px", textAlign: "center", color: "#7d879b" }}>
              No recent activity yet.
            </div>
          ) : (
            <div className="bzd-activity-list">
              {recentActivity.map((item, index) => (
                <div className="bzd-activity-card" key={item.id}>
                  <div className={`bzd-activity-icon ${index % 3 === 0 ? "red" : index % 3 === 1 ? "orange" : "purple"}`}>🏪</div>
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
    );
  }

  return (
    <div className="bzd-page" data-brand="bounce">
      <ThemeOverrides />
      {content}

      {showLogoutConfirm && (
        <div className="crz-logout-overlay" onClick={() => setShowLogoutConfirm(false)}>
          <div className="crz-logout-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Logout</h3>
            <p>Are you sure you want to logout?</p>
            <div className="crz-logout-actions">
              <button className="crz-logout-cancel" onClick={() => setShowLogoutConfirm(false)}>Cancel</button>
              <button className="crz-logout-confirm bzd-logout-confirm" onClick={handleLogout}>Yes</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
