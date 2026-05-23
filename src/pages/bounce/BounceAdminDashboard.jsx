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
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import bounceLogo from "../../assets/9aaf616a1f05b52baba7f0d12dcc6600408fd0e3 (1).png";
import AdminProductEditPanel from "../../components/AdminProductEditPanel";
import AdminProfileEditor from "../../components/AdminProfileEditor";
import CategoryModal from "../../components/CategoryModal";
import { getFirebaseServices } from "../../firebase";
import { routeToChooseSelection, usePortalHistoryManager } from "../../navigation/globalNavigationManager";
import HistoryDateFilter, { getFilterLabel, getFilterHeading } from "../../components/HistoryDateFilter";

const { auth, db, storage } = getFirebaseServices("bounce");

const BRAND = "#53b6e2";
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

const ZONES = ["Chennai", "Hyderabad", "Tamil Nadu", "Karnataka"];
const CATEGORY_OPTIONS = ["Club Soda", "Hemp Based", "Iced Tea", "Soda", "Energy Drink", "Juice"];
const ADD_CATEGORY_VALUE = "__add_new_category__";
const PRICING_GROUPS = ["Standard Retail", "Wholesale", "Distributor"];

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
  return `₹${Number(n.toFixed(2)).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

function sanitizeNumber(value) {
  return value.replace(/[^\d]/g, "");
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

function getTopSku(orders) {
  const map = {};
  orders.forEach((order) => {
    (order.items || []).forEach((item) => {
      const key = item.name || "Unknown SKU";
      map[key] = (map[key] || 0) + Number(item.quantity || 0);
    });
  });

  const entries = Object.entries(map).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return { name: "No sales yet", units: 0 };
  return { name: entries[0][0], units: entries[0][1] };
}

function getPincodeStats(orders) {
  const map = {};
  orders.forEach((order) => {
    const pincode = String(order.salesPincode || order.pincode || "").trim() || "Unassigned";
    map[pincode] = (map[pincode] || 0) + Number(order.total || 0);
  });

  const entries = Object.entries(map).sort((a, b) => b[1] - a[1]);
  const max = entries.length ? entries[0][1] : 1;

  return entries.map(([name, value]) => ({
    name,
    value,
    percent: Math.max(8, Math.round((value / max) * 100)),
  }));
}

function AdminTab({ active, label, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        flex: 1,
        height: 40,
        border: "none",
        borderRadius: 12,
        background: active ? "#edf8fd" : "transparent",
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
        flex: 1,
        background: CARD,
        border: `1px solid ${BORDER}`,
        borderRadius: 18,
        padding: 16,
        minWidth: 0,
        boxSizing: "border-box",
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
      <div
        style={{
          marginTop: 8,
          fontSize: 28,
          fontWeight: 800,
          color: TEXT,
          lineHeight: 1.15,
          overflowWrap: "anywhere",
        }}
      >
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

export default function BounceAdminDashboard() {
  const navigate = useNavigate();
  const fileInputRef = useRef(null);

  const [activeTab, setActiveTab] = useState("dashboard");
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [userProfile, setUserProfile] = useState(null);

  const [products, setProducts] = useState([]);
  const [orders, setOrders] = useState([]);

  const [inventorySearch, setInventorySearch] = useState("");
  const [salesSearch, setSalesSearch] = useState("");
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
    rate: "",
    pricingGroup: "Standard Retail",
    gst: "18",
    description: "",
    skuCode: "",
    unitLabel: "Units",
    stock: "0",
    lowStockThreshold: "20",
    category: "Club Soda",
    zones: [],
  });
  const [customCategoryOptions, setCustomCategoryOptions] = useState([]);
  const [categoryModalOpen, setCategoryModalOpen] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [newCategoryError, setNewCategoryError] = useState("");
  const [editingProductId, setEditingProductId] = useState(null);
  const [editingProductForm, setEditingProductForm] = useState({ name: "", rate: "" });
  const [savingProductEdit, setSavingProductEdit] = useState(false);

  const goToTab = usePortalHistoryManager({
    portalKey: "bounce-admin",
    rootScreen: "dashboard",
    currentScreen: activeTab,
    setScreen: setActiveTab,
    basePath: "/bounce/admin",
    onRootBack: () => setShowLogoutConfirm(true),
  });

  useEffect(() => {
    let unsubProducts = () => {};
    let unsubOrders = () => {};

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
    };
  }, [navigate]);

  const totalSalesValue = useMemo(
    () => orders.reduce((sum, item) => sum + Number(item.total || 0), 0),
    [orders]
  );

  const inventoryValue = useMemo(
    () =>
      products.reduce(
        (sum, item) => sum + Number(item.stock || 0) * Number(item.rate || 0),
        0
      ),
    [products]
  );

  const lowStockCount = useMemo(
    () =>
      products.filter(
        (item) => Number(item.stock || 0) <= Number(item.lowStockThreshold || 20)
      ).length,
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

  const topSku = useMemo(() => getTopSku(orders), [orders]);
  const pincodeStats = useMemo(() => getPincodeStats(orders), [orders]);
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

  const handleProductInput = (e) => {
    const { name, value } = e.target;
    let finalValue = value;

    if (["rate", "stock", "lowStockThreshold", "gst"].includes(name)) {
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
      rate: "",
      pricingGroup: "Standard Retail",
      gst: "18",
      description: "",
      skuCode: "",
      unitLabel: "Units",
      stock: "0",
      lowStockThreshold: "20",
      category: "Club Soda",
      zones: [],
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

    if (!productForm.rate.trim()) {
      setProductMessage("Please enter product rate.");
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

      await addDoc(collection(db, "products"), {
        name: productForm.name.trim(),
        rate: Number(productForm.rate || 0),
        pricingGroup: productForm.pricingGroup,
        gst: Number(productForm.gst || 0),
        description: productForm.description.trim(),
        skuCode: productForm.skuCode.trim(),
        unitLabel: productForm.unitLabel.trim() || "Units",
        stock: Number(productForm.stock || 0),
        openingStock: Number(productForm.stock || 0),
        lowStockThreshold: Number(productForm.lowStockThreshold || 20),
        category: productForm.category,
        zones: productForm.zones,
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

  const updateStock = async (product, delta) => {
    const nextStock = Math.max(0, Number(product.stock || 0) + delta);
    try {
      await updateDoc(doc(db, "products", product.id), {
        stock: nextStock,
      });
    } catch (error) {
      console.error("Stock update failed:", error);
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
    setEditingProductId(product.id);
    setEditingProductForm({
      name: product.name || "",
      rate: String(product.rate ?? product.price ?? ""),
    });
  };

  const cancelProductEdit = () => {
    setEditingProductId(null);
    setEditingProductForm({ name: "", rate: "" });
  };

  const handleProductEditInput = (event) => {
    const { name, value } = event.target;
    setEditingProductForm((prev) => ({
      ...prev,
      [name]: name === "rate" ? sanitizeNumber(value) : value,
    }));
  };

  const handleSaveProductEdit = async (product) => {
    const nextName = editingProductForm.name.trim();
    const nextRate = editingProductForm.rate.trim();

    if (!nextName) {
      alert("Please enter product name.");
      return;
    }

    if (!nextRate) {
      alert("Please enter original price.");
      return;
    }

    try {
      setSavingProductEdit(true);
      await updateDoc(doc(db, "products", product.id), {
        name: nextName,
        rate: Number(nextRate || 0),
        price: Number(nextRate || 0),
        updatedAtMs: Date.now(),
      });
      cancelProductEdit();
    } catch (error) {
      console.error("Product edit failed:", error);
      alert("Failed to update product.");
    } finally {
      setSavingProductEdit(false);
    }
  };

  const handleDeleteProduct = async (product) => {
    const ok = window.confirm(`Delete ${product.name || "this product"} from inventory?`);
    if (!ok) return;

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
          }
          .admin-shell-wrapper {
            max-width: none !important;
            min-height: 100vh !important;
            border: none !important;
            box-shadow: none !important;
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
                src={bounceLogo}
                alt="Bounce"
                style={{ height: 44, maxWidth: 150, objectFit: "contain", objectPosition: "left center" }}
              />
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
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
                  borderRadius: "50%",
                  border: `2px solid ${activeTab === "profile" ? BRAND : "transparent"}`,
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
              logo={bounceLogo}
              logoAlt="Bounce"
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
                  Here's your beverage business status today.
                </p>
              </div>

              <div
                style={{
                  display: "flex",
                  gap: 12,
                  marginBottom: 16,
                  width: "100%",
                }}
              >
                <StatCard
                  title="Total Sales"
                  value={formatCompact(totalSalesValue)}
                  subtitle={`${orders.length} closed sales`}
                />
                <StatCard
                  title="Revenue Units"
                  value={products.reduce((s, p) => s + Number(p.stock || 0), 0)}
                  subtitle="Current stock count"
                />
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
                    {products[0]?.imageUrl ? (
                      <img
                        src={products[0].imageUrl}
                        alt={products[0].name}
                        style={{ maxHeight: 120, objectFit: "contain" }}
                      />
                    ) : (
                      <img
                        src={bounceLogo}
                        alt="Bounce"
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
                        background: "#d9eef7",
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          width: topSku.units ? "78%" : "12%",
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
                          gap: 12,
                          alignItems: "center",
                          marginBottom: 12,
                          width: "100%",
                        }}
                      >
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 16, fontWeight: 800, color: TEXT, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>Sales by Pincode</div>
                          <div style={{ fontSize: 12, color: MUTED }}>Monthly pincode distribution</div>
                        </div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: BRAND, flexShrink: 0 }}>Maps ⌃</div>
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
                        <span>{item.name.toUpperCase()}</span>
                        <span>{formatCompact(item.value)}</span>
                      </div>
                      <div
                        style={{
                          marginTop: 6,
                          height: 6,
                          borderRadius: 999,
                          background: "#d9eef7",
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
                  {products.slice(0, 3).map((item, index) => (
                    <div
                      key={item.id}
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
                          Category: {item.category || "Beverages"}
                        </div>
                      </div>

                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontSize: 13, fontWeight: 800, color: TEXT }}>
                          {Number(item.stock || 0)} Units
                        </div>
                        <div style={{ fontSize: 11, color: BRAND }}>
                          {formatCompact(Number(item.stock || 0) * Number(item.rate || 0))} Total
                        </div>
                      </div>
                    </div>
                  ))}
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
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 15, fontWeight: 800, color: TEXT, overflowWrap: "break-word" }}>
                            {order.shopName || "Unnamed Shop"}
                          </div>
                          <div style={{ fontSize: 12, color: MUTED, marginTop: 4, overflowWrap: "break-word" }}>
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
                    border: "1.5px dashed #cbe8f4",
                    background: "#f8fdff",
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
                      placeholder="e.g. Bounce Club Soda"
                      style={{
                        width: "100%",
                        height: 44,
                        borderRadius: 12,
                        border: `1px solid ${BORDER}`,
                        padding: "0 14px",
                        outline: "none",
                        background: "#fff",
                        boxSizing: "border-box",
                      }}
                    />
                  </label>

                  <label style={{ display: "grid", gap: 6 }}>
                    <span style={PRODUCT_LABEL_STYLE}>
                      RATE (₹)
                    </span>
                    <input
                      name="rate"
                      value={productForm.rate}
                      onChange={handleProductInput}
                      placeholder="0.00"
                      style={{
                        width: "100%",
                        height: 44,
                        borderRadius: 12,
                        border: `1px solid ${BORDER}`,
                        padding: "0 14px",
                        outline: "none",
                        background: "#fff",
                        boxSizing: "border-box",
                      }}
                    />
                  </label>

                  <label style={{ display: "grid", gap: 6 }}>
                    <span style={PRODUCT_LABEL_STYLE}>
                      PRICING GROUP
                    </span>
                    <select
                      name="pricingGroup"
                      value={productForm.pricingGroup}
                      onChange={handleProductInput}
                      style={{
                        width: "100%",
                        height: 44,
                        borderRadius: 12,
                        border: `1px solid ${BORDER}`,
                        padding: "0 14px",
                        outline: "none",
                        background: "#fff",
                        boxSizing: "border-box",
                      }}
                    >
                      {PRICING_GROUPS.map((item) => (
                        <option key={item} value={item}>
                          {item}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label style={{ display: "grid", gap: 6 }}>
                    <span style={PRODUCT_LABEL_STYLE}>
                      GST (%)
                    </span>
                    <input
                      name="gst"
                      value={productForm.gst}
                      onChange={handleProductInput}
                      placeholder="18"
                      style={{
                        width: "100%",
                        height: 44,
                        borderRadius: 12,
                        border: `1px solid ${BORDER}`,
                        padding: "0 14px",
                        outline: "none",
                        background: "#fff",
                        boxSizing: "border-box",
                      }}
                    />
                  </label>

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
                        width: "100%",
                        borderRadius: 12,
                        border: `1px solid ${BORDER}`,
                        padding: 14,
                        outline: "none",
                        resize: "vertical",
                        fontFamily: "inherit",
                        background: "#fff",
                        boxSizing: "border-box",
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
                        width: "100%",
                        height: 44,
                        borderRadius: 12,
                        border: `1px solid ${BORDER}`,
                        padding: "0 14px",
                        outline: "none",
                        background: "#fff",
                        boxSizing: "border-box",
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
                        alignItems: "center",
                        gap: 8,
                        width: "100%",
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
                          flex: 1,
                          minWidth: 0,
                          height: 44,
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
                          flexShrink: 0,
                          width: 70,
                          height: 44,
                          border: "none",
                          borderRadius: 12,
                          background: BRAND,
                          color: "#fff",
                          fontWeight: 700,
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
                      placeholder="e.g. BNC-001"
                      style={{
                        width: "100%",
                        height: 44,
                        borderRadius: 12,
                        border: `1px solid ${BORDER}`,
                        padding: "0 14px",
                        outline: "none",
                        background: "#fff",
                        boxSizing: "border-box",
                      }}
                    />
                  </label>

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr",
                      gap: 12,
                    }}
                  >
                    <label style={{ display: "grid", gap: 6 }}>
                      <span style={PRODUCT_LABEL_STYLE}>
                        OPENING STOCK
                      </span>
                      <input
                        name="stock"
                        value={productForm.stock}
                        onChange={handleProductInput}
                        placeholder="Enter quantity"
                        style={{
                          width: "100%",
                          height: 44,
                          borderRadius: 12,
                          border: `1px solid ${BORDER}`,
                          padding: "0 14px",
                          outline: "none",
                          background: "#fff",
                          boxSizing: "border-box",
                        }}
                      />
                    </label>

                    <label style={{ display: "grid", gap: 6 }}>
                      <span style={PRODUCT_LABEL_STYLE}>
                        LOW STOCK ALERT
                      </span>
                      <input
                        name="lowStockThreshold"
                        value={productForm.lowStockThreshold}
                        onChange={handleProductInput}
                        placeholder="20"
                        style={{
                          width: "100%",
                          height: 44,
                          borderRadius: 12,
                          border: `1px solid ${BORDER}`,
                          padding: "0 14px",
                          outline: "none",
                          background: "#fff",
                          boxSizing: "border-box",
                        }}
                      />
                    </label>
                  </div>
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
                    const lowStock = Number(item.stock || 0) <= Number(item.lowStockThreshold || 20);
                    const isEditing = editingProductId === item.id;

                    return (
                      <SectionCard key={item.id}>
                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: "64px minmax(0, 1fr) auto",
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
                                src={bounceLogo}
                                alt="Bounce"
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
                              {item.category || "Beverages"} • {item.skuCode || "No SKU"}
                            </div>
                            <div
                              style={{
                                fontSize: 11,
                                color: lowStock ? BRAND : "#27944e",
                                marginTop: 6,
                                fontWeight: 700,
                              }}
                            >
                              {item.stock} {item.unitLabel || "Units"} {lowStock ? "• LOW STOCK" : ""}
                            </div>
                          </div>

                          <div style={{ textAlign: "right" }}>
                            <div style={{ fontSize: 14, fontWeight: 800, color: TEXT }}>
                              {formatRupees(item.rate)}
                            </div>
                            <div style={{ fontSize: 11, color: MUTED, marginTop: 4 }}>per unit</div>
                          </div>
                        </div>

                        {isEditing ? (
                          <AdminProductEditPanel
                            form={editingProductForm}
                            onChange={handleProductEditInput}
                            onSave={() => handleSaveProductEdit(item)}
                            onCancel={cancelProductEdit}
                            saving={savingProductEdit}
                            brand={BRAND}
                            text={TEXT}
                            muted={MUTED}
                            border={BORDER}
                          />
                        ) : null}

                        <div
                          style={{
                            marginTop: 12,
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            gap: 12,
                            flexWrap: "wrap",
                          }}
                        >
                          <div
                            style={{
                              display: "inline-grid",
                              gridTemplateColumns: "36px 44px 36px",
                              border: `1px solid ${BORDER}`,
                              borderRadius: 999,
                              overflow: "hidden",
                              width: "fit-content",
                            }}
                          >
                            <button
                              type="button"
                              onClick={() => updateStock(item, -1)}
                              style={{
                                border: "none",
                                background: "#fff",
                                cursor: "pointer",
                                fontSize: 18,
                              }}
                            >
                              −
                            </button>
                            <div
                              style={{
                                display: "grid",
                                placeItems: "center",
                                fontWeight: 800,
                                color: TEXT,
                                background: "#fff",
                              }}
                            >
                              {item.stock || 0}
                            </div>
                            <button
                              type="button"
                              onClick={() => updateStock(item, 1)}
                              style={{
                                border: "none",
                                background: "#fff",
                                cursor: "pointer",
                                fontSize: 18,
                              }}
                            >
                              +
                            </button>
                          </div>

                          <div
                            style={{
                              display: "flex",
                              gap: 8,
                              flexWrap: "wrap",
                              justifyContent: "flex-end",
                            }}
                          >
                            <button
                              type="button"
                              onClick={() => startProductEdit(item)}
                              style={{
                                height: 34,
                                padding: "0 12px",
                                borderRadius: 999,
                                border: `1px solid ${isEditing ? BRAND : BORDER}`,
                                background: isEditing ? "#edf8fd" : "#fff",
                                color: isEditing ? BRAND : TEXT,
                                fontWeight: 700,
                                cursor: "pointer",
                              }}
                            >
                              {isEditing ? "Editing" : "Edit"}
                            </button>

                            <button
                              type="button"
                              onClick={() => toggleProductStatus(item)}
                              style={{
                                height: 34,
                                padding: "0 12px",
                                borderRadius: 999,
                                border: `1px solid ${item.status === "inactive" ? BRAND : BORDER}`,
                                background: item.status === "inactive" ? "#edf8fd" : "#fff",
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
                                border: `1px solid #bfeafb`,
                                background: "#f4fcff",
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

      <CategoryModal
        open={categoryModalOpen}
        value={newCategoryName}
        error={newCategoryError}
        confirmClassName="bzd-logout-confirm"
        onChange={(value) => {
          setNewCategoryName(value);
          setNewCategoryError("");
        }}
        onClose={closeCategoryModal}
        onSubmit={submitNewCategory}
      />

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
