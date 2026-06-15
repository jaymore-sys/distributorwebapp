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
import { routeToChooseSelection, usePortalHistoryManager } from "../../navigation/globalNavigationManager";
import { normalizeCrunzzoPackOptions } from "../../utils/crunzzoPacks";
import {
  getCrunzzoRegionId,
  getCrunzzoUserRegion,
  getRegionalRemainingUnits,
} from "../../utils/crunzzoRegions";
import "./crunzzo-super-stockist.css";

const { auth, db, storage } = getFirebaseServices("crunzzo");

function formatNumber(value) {
  return Number(value || 0).toLocaleString("en-IN");
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
  const [distributors, setDistributors] = useState([]);
  const [dataError, setDataError] = useState("");
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMessage, setProfileMessage] = useState("");
  const [profileImageFile, setProfileImageFile] = useState(null);
  const [profilePreview, setProfilePreview] = useState("");
  const [profileForm, setProfileForm] = useState({ name: "", phone: "" });

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
    let unsubscribeDistributors = () => {};

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

        unsubscribeDistributors = onSnapshot(
          collection(db, "users"),
          (snapshot) => {
            setDistributors(
              snapshot.docs
                .map((item) => ({ id: item.id, ...item.data() }))
                .filter(
                  (item) =>
                    item.role === "distributor" &&
                    getCrunzzoUserRegion(item, "") === region
                )
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
      unsubscribeDistributors();
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
            <button type="button" className="css-avatar" onClick={() => goToTab("profile")}>
              {userProfile.profileImageUrl ? (
                <img src={userProfile.profileImageUrl} alt={userProfile.name || "Profile"} />
              ) : (
                (userProfile.name || "S").charAt(0).toUpperCase()
              )}
            </button>
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
                <Card><span>Distributors</span><strong>{formatNumber(distributors.length)}</strong><small>in region</small></Card>
                <Card><span>Products</span><strong>{formatNumber(visibleAllocations.length)}</strong><small>allocated SKUs</small></Card>
              </div>
              <Card className="css-summary-card">
                <h2>Regional Activity</h2>
                <div><span>Allocated products</span><strong>{formatNumber(visibleAllocations.length)}</strong></div>
                <div><span>Units currently available</span><strong>{formatNumber(remainingInventory)}</strong></div>
                <div><span>Stock received from admin</span><strong>{formatNumber(allocatedInventory)} units</strong></div>
              </Card>
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
              <div className="css-title-block"><h1>Regional Distributors</h1><p>Read-only distributor directory.</p></div>
              <div className="css-list">
                {distributors.length ? distributors.map((distributor) => (
                  <Card key={distributor.id}>
                    <div className="css-person-row">
                      <div className="css-person-avatar">{(distributor.name || "D").charAt(0).toUpperCase()}</div>
                      <div><h2>{distributor.name || "Distributor"}</h2><p>{distributor.businessName || "No business name"}</p></div>
                    </div>
                    <div className="css-detail-grid">
                      <span>ID<strong>{distributor.distributorId || "-"}</strong></span>
                      <span>Phone<strong>{distributor.phone || "-"}</strong></span>
                    </div>
                  </Card>
                )) : <Card><p className="css-empty">No distributors found in this region.</p></Card>}
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
            ["distributors", "Distributors"],
            ["profile", "Profile"],
          ].map(([tab, label]) => (
            <button key={tab} type="button" className={activeTab === tab ? "active" : ""} onClick={() => goToTab(tab)}>
              <StockistNavIcon type={tab} />
              <span>{label}</span>
            </button>
          ))}
        </nav>
      </div>

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
