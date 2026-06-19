import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { onAuthStateChanged, signOut } from "firebase/auth";
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  updateDoc,
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
import "./crunzzo-super-stockist.css";

const { auth, db, storage } = getFirebaseServices("crunzzo");
const STOCKIST_VIEWED_NOTIFICATIONS_KEY = "crunzzo_stockist_viewed_notifications_v1";

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
    // Notification read state should not block the dashboard.
  }
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString("en-IN");
}

function formatRupees(value) {
  return `₹${Number(value || 0).toLocaleString("en-IN", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  })}`;
}

function formatTime(value) {
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

function getSmallestPackSize(product) {
  const packSizes = normalizeCrunzzoPackOptions(product)
    .map((pack) => Number(pack.packSize || 0))
    .filter((size) => size > 0);
  return packSizes.length ? Math.min(...packSizes) : 1;
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

function Card({ children, className = "" }) {
  return <div className={`css-card ${className}`.trim()}>{children}</div>;
}

function StockistNavIcon({ type }) {
  if (type === "dashboard") {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z" /></svg>;
  }
  if (type === "inventory") {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16v13H4zM8 3h8v4H8z" /></svg>;
  }
  if (type === "distributors") {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3" /><circle cx="17" cy="9" r="2.3" /><path d="M3.5 20c1-3.5 3.4-5.2 5.5-5.2s4.5 1.7 5.5 5.2M14.5 15.5c2.7-.8 5.1.7 6 3.5" /></svg>;
  }
  if (type === "notifications") {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" /><path d="M10 21h4" /></svg>;
  }
  return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3.2" /><path d="M5 20c1.4-3.3 4.2-5 7-5s5.6 1.7 7 5" /></svg>;
}

export default function CrunzzoSuperStockistDashboard() {
  const navigate = useNavigate();
  const fileInputRef = useRef(null);
  const regionalProjectionSyncKeyRef = useRef("");
  const [activeTab, setActiveTab] = useState("dashboard");
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [userProfile, setUserProfile] = useState(null);
  const [products, setProducts] = useState([]);
  const [allocations, setAllocations] = useState([]);
  const [regionalPartners, setRegionalPartners] = useState([]);
  const [orders, setOrders] = useState([]);
  const [dataError, setDataError] = useState("");
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMessage, setProfileMessage] = useState("");
  const [profileImageFile, setProfileImageFile] = useState(null);
  const [profilePreview, setProfilePreview] = useState("");
  const [profileForm, setProfileForm] = useState({ name: "", phone: "" });
  const [salesHistoryFilter, setSalesHistoryFilter] = useState("today");
  const [salesStartDate, setSalesStartDate] = useState(null);
  const [salesEndDate, setSalesEndDate] = useState(null);
  const [salesHistorySearch, setSalesHistorySearch] = useState("");
  const [viewedNotifications, setViewedNotifications] = useState(() =>
    readStoredIdMap(STOCKIST_VIEWED_NOTIFICATIONS_KEY)
  );
  const [selectedNotification, setSelectedNotification] = useState(null);

  const goToTab = usePortalHistoryManager({
    portalKey: "crunzzo-super-stockist",
    basePath: "/crunzzo/super-stockist",
    rootScreen: "dashboard",
    currentScreen: activeTab,
    setScreen: setActiveTab,
    onRootBack: () => setShowLogoutConfirm(true),
  });

  useEffect(() => {
    if (activeTab === "requests") goToTab("dashboard", { replace: true });
  }, [activeTab, goToTab]);

  useEffect(() => {
    setShowLogoutConfirm(false);
  }, [activeTab]);

  useEffect(() => {
    let unsubscribeAllocations = () => {};
    let unsubscribeProducts = () => {};
    let unsubscribeRegionalPartners = () => {};
    let unsubscribeOrders = () => {};

    const handleReadError = () => {
      setDataError(
        "Regional data access is waiting for the Super Stockist Firebase security rule."
      );
    };

    const unsubscribeAuth = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        setUserProfile(null);
        setLoading(false);
        routeToChooseSelection(navigate);
        return;
      }

      try {
        const userSnapshot = await getDoc(doc(db, "users", user.uid));
        const profile = userSnapshot.exists() ? userSnapshot.data() : {};
        const mergedProfile = { uid: user.uid, email: user.email || "", ...profile };
        const region = getCrunzzoUserRegion(mergedProfile, "");
        const regionId = getCrunzzoRegionId(region);

        setUserProfile({ ...mergedProfile, region });
        setProfileForm({ name: mergedProfile.name || "", phone: mergedProfile.phone || "" });
        setProfilePreview(mergedProfile.profileImageUrl || "");

        if (mergedProfile.role !== "super_stockist" || !regionId) {
          setLoading(false);
          return;
        }

        unsubscribeAllocations = onSnapshot(
          collection(db, "regional_inventory", regionId, "products"),
          (snapshot) => {
            setAllocations(
              snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))
            );
          },
          handleReadError
        );

        unsubscribeProducts = onSnapshot(
          collection(db, "products"),
          (snapshot) => {
            setProducts(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })));
          },
          handleReadError
        );

        unsubscribeRegionalPartners = onSnapshot(
          collection(db, "users"),
          (snapshot) => {
            setRegionalPartners(
              snapshot.docs
                .map((item) => ({ id: item.id, ...item.data() }))
                .filter(
                  (item) =>
                    (item.role === "distributor" || item.role === "retailer") &&
                    getCrunzzoUserRegion(item, "") === region
                )
            );
          },
          handleReadError
        );

        unsubscribeOrders = onSnapshot(
          collection(db, "orders"),
          (snapshot) => {
            setOrders(
              snapshot.docs
                .map((item) => ({ id: item.id, ...item.data() }))
                .filter((item) => getCrunzzoUserRegion(item, "") === region)
                .sort((a, b) => Number(b.createdAtMs || 0) - Number(a.createdAtMs || 0))
            );
          },
          handleReadError
        );

      } catch (error) {
        console.error("Super Stockist dashboard load failed:", error);
      } finally {
        setLoading(false);
      }
    });

    return () => {
      unsubscribeAuth();
      unsubscribeAllocations();
      unsubscribeProducts();
      unsubscribeRegionalPartners();
      unsubscribeOrders();
    };
  }, [navigate]);

  const productMap = useMemo(
    () => Object.fromEntries(products.map((product) => [product.id, product])),
    [products]
  );

  const visibleAllocations = useMemo(
    () =>
      allocations
        .filter((allocation) => Number(allocation.allocatedUnits || 0) > 0)
        .map((allocation) => ({
          ...allocation,
          product: productMap[allocation.productId || allocation.id] || null,
        })),
    [allocations, productMap]
  );

  useEffect(() => {
    const regionId = getCrunzzoRegionId(userProfile?.region);
    if (!regionId || !allocations.length || !products.length) return;

    const projectionRows = allocations
      .map((allocation) => ({
        productId: allocation.productId || allocation.id,
        remainingUnits: getRegionalRemainingUnits(allocation),
      }))
      .filter((item) => productMap[item.productId]);
    const syncKey = JSON.stringify(projectionRows);
    if (!projectionRows.length || regionalProjectionSyncKeyRef.current === syncKey) return;
    regionalProjectionSyncKeyRef.current = syncKey;

    const pendingUpdates = projectionRows.filter(
      ({ productId, remainingUnits }) =>
        Number(productMap[productId]?.regionalStock?.[regionId]) !== remainingUnits
    );
    if (!pendingUpdates.length) return;

    Promise.all(
      pendingUpdates.map(({ productId, remainingUnits }) =>
        updateDoc(doc(db, "products", productId), {
          [`regionalStock.${regionId}`]: remainingUnits,
          regionalStockUpdatedAtMs: Date.now(),
        })
      )
    ).catch((error) => {
      console.warn("Regional stock projection requires an admin sync:", error.code || error.message);
    });
  }, [allocations, productMap, products.length, userProfile?.region]);

  const allocatedInventory = allocations.reduce(
    (sum, item) => sum + Number(item.allocatedUnits || 0),
    0
  );
  const remainingInventory = allocations.reduce(
    (sum, item) => sum + getRegionalRemainingUnits(item),
    0
  );

  const stockistNotifications = useMemo(() => {
    const alerts = [];

    orders.slice(0, 8).forEach((order) => {
      const partnerName = getOrderPartnerName(order);
      const totalUnits = getOrderUnits(order);
      const itemSummary = getOrderItemsSummary(order);

      alerts.push({
        id: `order-${order.id}`,
        tone: order.orderType === "retailer_purchase" ? "#b45309" : "#e51f28",
        title: order.orderType === "retailer_purchase" ? "Retailer purchase in your region" : "Distributor sale in your region",
        message: `${order.partnerName || order.retailerName || order.distributorName || order.shopName || "Partner"} • ${formatRupees(order.total || 0)}`,
        detail: [
          `Partner: ${partnerName}`,
          `Region: ${order.region || userProfile?.region || "No region"}`,
          `Total: ${formatRupees(order.total || 0)}`,
          `Units: ${totalUnits}`,
          `Items: ${itemSummary}`,
          order.invoiceNumber ? `Invoice: ${order.invoiceNumber}` : "",
        ].filter(Boolean).join("\n"),
        time: formatTime(order.createdAtMs),
        createdAtMs: Number(order.createdAtMs || 0),
      });
    });

    visibleAllocations.forEach((allocation) => {
      const product = allocation.product || {};
      const remaining = getRegionalRemainingUnits(allocation);
      const minPack = getSmallestPackSize(product);
      if (remaining > 0 && remaining < minPack) {
        alerts.push({
          id: `pack-${allocation.id}`,
          tone: "#b45309",
          title: "No full pack available",
          message: `${product.name || allocation.productName || "Product"} has ${remaining} units left, below the ${minPack}-unit pack.`,
          detail: [
            `Product: ${product.name || allocation.productName || "Product"}`,
            `SKU: ${product.skuCode || allocation.skuCode || "-"}`,
            `Region: ${userProfile?.region || "Your region"}`,
            `Remaining regional stock: ${remaining} units`,
            `Smallest pack size: ${minPack} units`,
            "Action: Ask admin to allocate more units before partners can order this SKU.",
          ].join("\n"),
          time: "Inventory",
          createdAtMs: Number(allocation.updatedAtMs || 0),
        });
      }
    });

    return alerts.sort((a, b) => b.createdAtMs - a.createdAtMs).slice(0, 20);
  }, [orders, userProfile?.region, visibleAllocations]);

  const unreadStockistNotificationCount = stockistNotifications.filter(
    (item) => !viewedNotifications[item.id]
  ).length;
  const prioritizedStockistNotifications = useMemo(() => {
    const unread = [];
    const viewed = [];
    stockistNotifications.forEach((item) => {
      if (viewedNotifications[item.id]) viewed.push(item);
      else unread.push(item);
    });
    return [...unread, ...viewed];
  }, [stockistNotifications, viewedNotifications]);

  const openStockistNotification = (item) => {
    setSelectedNotification(item);
    setViewedNotifications((previous) => {
      if (previous[item.id]) return previous;
      const next = { ...previous, [item.id]: Date.now() };
      saveStoredIdMap(STOCKIST_VIEWED_NOTIFICATIONS_KEY, next);
      return next;
    });
  };

  const recentSales = orders.slice(0, 3);

  const filteredSalesOrders = useMemo(() => {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

    const weekDate = new Date(now);
    const day = weekDate.getDay();
    const diff = weekDate.getDate() - day + (day === 0 ? -6 : 1);
    const startOfWeek = new Date(weekDate.setDate(diff)).setHours(0, 0, 0, 0);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

    return orders.filter((order) => {
      const ts = Number(order.createdAtMs || 0);
      let timeMatch = true;

      if (salesHistoryFilter === "today") timeMatch = ts >= startOfToday;
      else if (salesHistoryFilter === "week") timeMatch = ts >= startOfWeek;
      else if (salesHistoryFilter === "month") timeMatch = ts >= startOfMonth;
      else if (salesHistoryFilter === "date" && salesStartDate) {
        const selectedStart = new Date(
          salesStartDate.getFullYear(),
          salesStartDate.getMonth(),
          salesStartDate.getDate()
        ).getTime();
        const selectedEnd = salesEndDate
          ? new Date(salesEndDate.getFullYear(), salesEndDate.getMonth(), salesEndDate.getDate()).getTime() + 86400000
          : selectedStart + 86400000;
        timeMatch = ts >= selectedStart && ts < selectedEnd;
      } else if (salesHistoryFilter === "all") timeMatch = true;

      const queryText = salesHistorySearch.toLowerCase().trim();
      const itemText = (order.items || []).map((item) => item.name || "").join(" ").toLowerCase();
      const searchMatch =
        !queryText ||
        getOrderPartnerName(order).toLowerCase().includes(queryText) ||
        String(order.id || "").toLowerCase().includes(queryText) ||
        String(order.invoiceNumber || "").toLowerCase().includes(queryText) ||
        itemText.includes(queryText);

      return timeMatch && searchMatch;
    });
  }, [orders, salesEndDate, salesHistoryFilter, salesHistorySearch, salesStartDate]);

  const salesHistoryTotal = filteredSalesOrders.reduce(
    (sum, order) => sum + Number(order.total || 0),
    0
  );
  const salesHistoryUnits = filteredSalesOrders.reduce(
    (sum, order) => sum + getOrderUnits(order),
    0
  );

  const handleProfileChange = (event) => {
    const { name, value } = event.target;
    const nextValue = name === "phone" ? value.replace(/\D/g, "").slice(0, 10) : value.replace(/[0-9]/g, "");
    setProfileMessage("");
    setProfileForm((previous) => ({ ...previous, [name]: nextValue }));
  };

  const handleProfileImage = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setProfileImageFile(file);
    setProfilePreview(URL.createObjectURL(file));
    setProfileMessage("");
  };

  const handleSaveProfile = async () => {
    if (!userProfile?.uid) return;
    if (!profileForm.name.trim()) {
      setProfileMessage("Please enter a name.");
      return;
    }
    if (profileForm.phone && !/^\d{10}$/.test(profileForm.phone)) {
      setProfileMessage("Phone number must be exactly 10 digits.");
      return;
    }

    try {
      setProfileSaving(true);
      setProfileMessage("");
      let profileImageUrl = userProfile.profileImageUrl || "";

      if (profileImageFile) {
        const extension = profileImageFile.name.split(".").pop() || "jpg";
        const imageRef = ref(
          storage,
          `profiles/${userProfile.uid}/super-stockist-avatar-${Date.now()}.${extension}`
        );
        await uploadBytes(imageRef, profileImageFile);
        profileImageUrl = await getDownloadURL(imageRef);
      }

      const payload = {
        name: profileForm.name.trim(),
        phone: profileForm.phone.trim(),
        profileImageUrl,
        updatedAtMs: Date.now(),
      };

      await updateDoc(doc(db, "users", userProfile.uid), payload);
      setUserProfile((previous) => ({ ...previous, ...payload }));
      setProfilePreview(profileImageUrl);
      setProfileImageFile(null);
      setProfileOpen(false);
      setProfileMessage("Profile updated successfully.");
    } catch (error) {
      console.error("Super Stockist profile update failed:", error);
      setProfileMessage("Failed to update profile.");
    } finally {
      setProfileSaving(false);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      routeToChooseSelection(navigate);
    } catch (error) {
      console.error("Super Stockist logout failed:", error);
    }
  };

  if (loading) {
    return <div className="css-loading">Loading Super Stockist dashboard...</div>;
  }

  if (!userProfile) {
    return <div className="css-loading">Please log in again.</div>;
  }

  if (userProfile.role !== "super_stockist") {
    return <div className="css-loading">This page is only for Crunzzo Super Stockists.</div>;
  }

  if (!getCrunzzoRegionId(userProfile.region)) {
    return <div className="css-loading">This Super Stockist account has no valid region.</div>;
  }

  return (
    <div className="css-page">
      <div className="css-shell">
        <div className="css-content">
          <header className="css-header">
            <div>
              <img src={crunzzoLogo} alt="Crunzzo" className="css-logo" />
              <p>{userProfile.region} Super Stockist</p>
            </div>
            <div className="css-header-actions">
              <button
                type="button"
                className={`css-alert-button${activeTab === "notifications" ? " active" : ""}`}
                onClick={() => goToTab("notifications")}
              >
                Alerts {unreadStockistNotificationCount ? `(${unreadStockistNotificationCount})` : ""}
              </button>
              <button type="button" className="css-header-logout" onClick={() => setShowLogoutConfirm(true)}>
                Logout
              </button>
              <button type="button" className="css-avatar" onClick={() => goToTab("profile")}>
                {userProfile.profileImageUrl ? (
                  <img src={userProfile.profileImageUrl} alt={userProfile.name || "Profile"} />
                ) : (
                  (userProfile.name || "S").charAt(0).toUpperCase()
                )}
              </button>
            </div>
          </header>

          {dataError ? <div className="css-message error">{dataError}</div> : null}

          {activeTab === "dashboard" ? (
            <>
              <div className="css-title-block">
                <h1>Regional Dashboard</h1>
                <p>Read-only operational view for {userProfile.region}.</p>
              </div>
              <div className="css-stat-grid">
                <Card><span>Allocated Inventory</span><strong>{formatNumber(allocatedInventory)}</strong><small>units assigned</small></Card>
                <Card><span>Current Stock</span><strong>{formatNumber(remainingInventory)}</strong><small>units available</small></Card>
                <Card><span>Partners</span><strong>{formatNumber(regionalPartners.length)}</strong><small>in region</small></Card>
                <Card><span>Products</span><strong>{formatNumber(visibleAllocations.length)}</strong><small>allocated SKUs</small></Card>
              </div>
              <Card className="css-summary-card">
                <h2>Regional Activity</h2>
                <div><span>Allocated products</span><strong>{formatNumber(visibleAllocations.length)}</strong></div>
                <div><span>Units currently available</span><strong>{formatNumber(remainingInventory)}</strong></div>
                <div><span>Stock received from admin</span><strong>{formatNumber(allocatedInventory)} units</strong></div>
                <div><span>Unread notifications</span><strong>{formatNumber(unreadStockistNotificationCount)}</strong></div>
              </Card>

              <div className="css-section-head">
                <h2>Sales History</h2>
                <button type="button" onClick={() => goToTab("sales")}>
                  View More
                </button>
              </div>
              <div className="css-list">
                {recentSales.length ? recentSales.map((order) => (
                  <Card key={order.id} className="css-sale-card">
                    <div className="css-sale-head">
                      <div>
                        <h2>{getOrderPartnerName(order)}</h2>
                        <p>{formatTime(order.createdAtMs)}</p>
                      </div>
                      <strong>{formatRupees(order.total || 0)}</strong>
                    </div>
                    <p className="css-sale-items">{getOrderItemsSummary(order)}</p>
                    <div className="css-sale-meta">
                      <span>{formatNumber(getOrderUnits(order))} units</span>
                      <span>{order.orderType === "retailer_purchase" ? "Retailer" : "Distributor"}</span>
                    </div>
                  </Card>
                )) : (
                  <Card><p className="css-empty">No regional sales yet.</p></Card>
                )}
              </div>
            </>
          ) : null}

          {activeTab === "inventory" ? (
            <>
              <div className="css-title-block"><h1>Allocated Inventory</h1><p>Only stock assigned to {userProfile.region} is shown.</p></div>
              <div className="css-list">
                {visibleAllocations.length ? visibleAllocations.map((allocation) => {
                  const product = allocation.product || {};
                  const remaining = getRegionalRemainingUnits(allocation);
                  return (
                    <Card key={allocation.id}>
                      <div className="css-product-head">
                        <div>
                          <h2>{product.name || allocation.productName || "Product"}</h2>
                          <p>{product.skuCode || allocation.skuCode || "No SKU"}</p>
                        </div>
                        <strong>{formatNumber(remaining)} units</strong>
                      </div>
                      <div className="css-allocation-row"><span>Allocated</span><b>{formatNumber(allocation.allocatedUnits)}</b></div>
                      <div className="css-allocation-row"><span>Remaining</span><b>{formatNumber(remaining)}</b></div>
                      <div className="css-pack-row">
                        {normalizeCrunzzoPackOptions(product).map((pack) => (
                          <span key={pack.id}>{pack.label}: {Math.floor(remaining / pack.packSize)} packs</span>
                        ))}
                      </div>
                    </Card>
                  );
                }) : <Card><p className="css-empty">No inventory has been allocated to this region.</p></Card>}
              </div>
            </>
          ) : null}

          {activeTab === "distributors" ? (
            <>
              <div className="css-title-block"><h1>Regional Partners</h1><p>Read-only distributor and retailer directory.</p></div>
              <div className="css-list">
                {regionalPartners.length ? regionalPartners.map((partner) => (
                  <Card key={partner.id}>
                    <div className="css-person-row">
                      <div className="css-person-avatar">{(partner.name || "P").charAt(0).toUpperCase()}</div>
                      <div><h2>{partner.name || "Partner"}</h2><p>{partner.businessName || "No business name"}</p></div>
                    </div>
                    <div className="css-detail-grid">
                      <span>Role<strong>{partner.role === "retailer" ? "Retailer" : "Distributor"}</strong></span>
                      <span>ID<strong>{partner.retailerId || partner.distributorId || partner.partnerId || "-"}</strong></span>
                      <span>Phone<strong>{partner.phone || "-"}</strong></span>
                    </div>
                  </Card>
                )) : <Card><p className="css-empty">No partners found in this region.</p></Card>}
              </div>
            </>
          ) : null}

          {activeTab === "notifications" ? (
            <>
              <div className="css-title-block"><h1>Notifications</h1><p>Regional order and stock alerts.</p></div>
              <div className="css-list">
                {prioritizedStockistNotifications.length ? prioritizedStockistNotifications.map((item) => {
                  const isViewed = Boolean(viewedNotifications[item.id]);
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className="css-notification-button"
                      onClick={() => openStockistNotification(item)}
                      style={{ order: isViewed ? 2 : 1 }}
                    >
                      <Card className={`css-notification-card${isViewed ? " is-viewed" : ""}`}>
                        <div className="css-notification-row">
                          <span style={{ background: isViewed ? "#cfd5df" : item.tone }} />
                          <div>
                            <div className="css-notification-head">
                              <h2>{item.title}</h2>
                              <small>{item.time}</small>
                            </div>
                            <p>{item.message}</p>
                            <b className={`css-read-pill${isViewed ? " is-viewed" : ""}`}>
                              {isViewed ? "Viewed" : "New"}
                            </b>
                          </div>
                        </div>
                      </Card>
                    </button>
                  );
                }) : <Card><p className="css-empty">No notifications yet.</p></Card>}
              </div>
            </>
          ) : null}

          {activeTab === "sales" ? (
            <>
              <div className="css-title-block">
                <h1>Sales History</h1>
                <p>Every distributor and retailer purchase in {userProfile.region}.</p>
              </div>

              <div className="css-sales-hero">
                <small>{getFilterLabel(salesHistoryFilter, salesStartDate, salesEndDate)}</small>
                <strong>{formatRupees(salesHistoryTotal)}</strong>
                <span>{filteredSalesOrders.length} sales • {formatNumber(salesHistoryUnits)} units</span>
              </div>

              <HistoryDateFilter
                historyFilter={salesHistoryFilter}
                setHistoryFilter={setSalesHistoryFilter}
                startDate={salesStartDate}
                setStartDate={setSalesStartDate}
                endDate={salesEndDate}
                setEndDate={setSalesEndDate}
                accentColor="#e51f28"
              />

              <div className="css-sales-search">
                <input
                  value={salesHistorySearch}
                  onChange={(event) => setSalesHistorySearch(event.target.value)}
                  placeholder="Search buyer, order, product..."
                />
              </div>

              <div className="css-history-label">
                {getFilterHeading(salesHistoryFilter, salesStartDate, salesEndDate)}
              </div>

              <div className="css-list">
                {filteredSalesOrders.length ? filteredSalesOrders.map((order) => (
                  <Card key={order.id} className="css-sale-card">
                    <div className="css-sale-head">
                      <div>
                        <h2>{getOrderPartnerName(order)}</h2>
                        <p>{formatTime(order.createdAtMs)}</p>
                      </div>
                      <strong>{formatRupees(order.total || 0)}</strong>
                    </div>
                    <p className="css-sale-items">{getOrderItemsSummary(order)}</p>
                    <div className="css-sale-meta">
                      <span>{formatNumber(getOrderUnits(order))} units</span>
                      <span>{order.orderType === "retailer_purchase" ? "Retailer" : "Distributor"}</span>
                    </div>
                  </Card>
                )) : (
                  <Card><p className="css-empty">No sales found for this filter.</p></Card>
                )}
              </div>
            </>
          ) : null}

          {activeTab === "profile" ? (
            <>
              <div className="css-profile-hero">
                <button type="button" className="css-profile-photo" onClick={() => fileInputRef.current?.click()}>
                  {profilePreview ? <img src={profilePreview} alt={profileForm.name || "Profile"} /> : (profileForm.name || "S").charAt(0).toUpperCase()}
                </button>
                <input ref={fileInputRef} type="file" accept="image/*" hidden onChange={handleProfileImage} />
                <h1>{profileForm.name || "Super Stockist"}</h1>
                <p>{userProfile.region} Region</p>
                <button type="button" className="css-outline-btn" onClick={() => setProfileOpen((open) => !open)}>Edit Profile</button>
              </div>
              {profileMessage ? <div className={`css-message ${profileMessage.includes("successfully") ? "success" : "error"}`}>{profileMessage}</div> : null}
              {profileOpen ? (
                <Card>
                  <div className="css-form">
                    <label>Name<input name="name" value={profileForm.name} onChange={handleProfileChange} /></label>
                    <label>Phone<input name="phone" inputMode="numeric" maxLength={10} value={profileForm.phone} onChange={handleProfileChange} /></label>
                    <label>Region<input value={userProfile.region} disabled /></label>
                    <div className="css-form-actions">
                      <button type="button" className="css-outline-btn" onClick={() => setProfileOpen(false)}>Cancel</button>
                      <button type="button" className="css-primary-btn" disabled={profileSaving} onClick={handleSaveProfile}>{profileSaving ? "Saving..." : "Save"}</button>
                    </div>
                  </div>
                </Card>
              ) : null}
              <button type="button" className="css-logout-btn" onClick={() => setShowLogoutConfirm(true)}>Logout Account</button>
            </>
          ) : null}
        </div>

        <nav className="css-bottom-nav">
          {[
            ["dashboard", "Dashboard"],
            ["inventory", "Inventory"],
            ["distributors", "Partners"],
            ["profile", "Profile"],
          ].map(([tab, label]) => (
            <button key={tab} type="button" className={activeTab === tab ? "active" : ""} onClick={() => goToTab(tab)}>
              <StockistNavIcon type={tab} />
              <span>{label}</span>
            </button>
          ))}
        </nav>
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
            aria-labelledby="stockist-notification-detail-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="css-notification-detail-marker" style={{ background: selectedNotification.tone }} />
            <h3 id="stockist-notification-detail-title">{selectedNotification.title}</h3>
            <p className="css-notification-detail-time">{selectedNotification.time}</p>
            <p className="css-notification-detail-message">{selectedNotification.message}</p>
            <div className="css-notification-detail-body">
              {selectedNotification.detail || selectedNotification.message}
            </div>
            <button
              type="button"
              className="crz-logout-confirm"
              onClick={() => setSelectedNotification(null)}
            >
              Close
            </button>
          </div>
        </div>
      ) : null}

      {showLogoutConfirm ? (
        <div className="crz-logout-overlay" onClick={() => setShowLogoutConfirm(false)}>
          <div className="crz-logout-modal" onClick={(event) => event.stopPropagation()}>
            <h3>Logout</h3>
            <p>Are you sure you want to logout?</p>
            <div className="crz-logout-actions">
              <button className="crz-logout-cancel" onClick={() => setShowLogoutConfirm(false)}>Cancel</button>
              <button className="crz-logout-confirm" onClick={handleLogout}>Yes</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
