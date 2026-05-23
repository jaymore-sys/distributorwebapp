import { useEffect, useRef, useState } from "react";
import { doc, updateDoc } from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";

function Field({ label, name, value, onChange, placeholder, type = "text" }) {
  return (
    <label style={{ display: "grid", gap: 7 }}>
      <span style={{ fontSize: 12, fontWeight: 800, color: "#20263a" }}>{label}</span>
      <input
        name={name}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        type={type}
        style={{
          width: "100%",
          height: 46,
          borderRadius: 14,
          border: "1px solid #ececec",
          padding: "0 14px",
          outline: "none",
          fontSize: 14,
          color: "#20263a",
          background: "#fff",
        }}
      />
    </label>
  );
}

function ProfileMenuRow({ title, subtitle, icon, accent, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        width: "100%",
        background: "#fff",
        border: "1px solid #ececec",
        borderRadius: 16,
        padding: 14,
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
          fontWeight: 900,
        }}
      >
        {icon}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: "#20263a" }}>{title}</div>
        <div style={{ fontSize: 11, color: "#7d879b", marginTop: 2 }}>{subtitle}</div>
      </div>

      <div style={{ color: "#9aa3b2", fontSize: 16 }}>{">"}</div>
    </button>
  );
}

export default function AdminProfileEditor({
  userProfile,
  setUserProfile,
  db,
  storage,
  brand,
  text,
  muted,
  border,
  card,
  logo,
  logoAlt,
  onBack,
  onNavigate,
  onLogout,
  stats = {},
}) {
  const fileInputRef = useRef(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [form, setForm] = useState({
    name: "",
    businessName: "",
    phone: "",
    territory: "",
  });
  const [imageFile, setImageFile] = useState(null);
  const [preview, setPreview] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!userProfile) return;

    setForm({
      name: userProfile.name || "",
      businessName: userProfile.businessName || "",
      phone: userProfile.phone || "",
      territory: userProfile.territory || "",
    });
    setPreview(userProfile.profileImageUrl || "");
    setImageFile(null);
    setMessage("");
  }, [userProfile?.uid]);

  const handleInput = (event) => {
    const { name, value } = event.target;
    setMessage("");
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleImagePick = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setImageFile(file);
    setPreview(URL.createObjectURL(file));
    setMessage("");
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      setMessage("Please enter admin name.");
      return;
    }

    const phone = form.phone.trim();
    if (phone && !/^\d{10}$/.test(phone)) {
      setMessage("Please enter a valid 10 digit phone number.");
      return;
    }

    try {
      setSaving(true);
      setMessage("");

      let profileImageUrl = userProfile.profileImageUrl || "";
      if (imageFile) {
        const extension = imageFile.name.split(".").pop() || "jpg";
        const imageRef = ref(
          storage,
          `profiles/${userProfile.uid}/admin-avatar-${Date.now()}.${extension}`
        );
        await uploadBytes(imageRef, imageFile);
        profileImageUrl = await getDownloadURL(imageRef);
      }

      const nextProfile = {
        name: form.name.trim(),
        businessName: form.businessName.trim(),
        phone,
        territory: form.territory.trim(),
        profileImageUrl,
        updatedAtMs: Date.now(),
      };

      await updateDoc(doc(db, "users", userProfile.uid), nextProfile);
      setUserProfile((prev) => ({ ...prev, ...nextProfile }));
      setPreview(profileImageUrl);
      setImageFile(null);
      setProfileOpen(false);
      setMessage("Profile updated successfully.");
    } catch (error) {
      console.error("Admin profile update failed:", error);
      setMessage("Failed to update profile.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          marginBottom: 14,
        }}
      >
        <button
          type="button"
          onClick={onBack}
          style={{
            border: `1px solid ${border}`,
            background: "#fff",
            color: brand,
            height: 34,
            padding: "0 12px",
            borderRadius: 10,
            fontWeight: 800,
            cursor: "pointer",
          }}
        >
          Back
        </button>

        <img
          src={logo}
          alt={logoAlt}
          style={{ height: 48, maxWidth: 150, objectFit: "contain" }}
        />
      </div>

      <div style={{ display: "grid", placeItems: "center", gap: 12 }}>
        <div style={{ position: "relative" }}>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            aria-label="Change profile photo"
            style={{
              width: 128,
              height: 128,
              borderRadius: "50%",
              border: "4px solid #fff",
              background: "#f2f4f7",
              boxShadow: "0 8px 22px rgba(0,0,0,0.09)",
              overflow: "hidden",
              display: "grid",
              placeItems: "center",
              color: text,
              fontWeight: 900,
              fontSize: 34,
              cursor: "pointer",
              padding: 0,
            }}
          >
            {preview ? (
              <img
                src={preview}
                alt={form.name || "Admin profile"}
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
            ) : (
              (form.name || "A").charAt(0).toUpperCase()
            )}
          </button>

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            aria-label="Change profile photo"
            style={{
              position: "absolute",
              right: 2,
              bottom: 8,
              width: 34,
              height: 34,
              borderRadius: "50%",
              border: "3px solid #fff",
              background: brand,
              color: "#fff",
              display: "grid",
              placeItems: "center",
              cursor: "pointer",
              fontSize: 16,
              fontWeight: 900,
              boxShadow: "0 4px 10px rgba(0,0,0,0.18)",
            }}
          >
            +
          </button>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleImagePick}
          style={{ display: "none" }}
        />

        <h1 style={{ margin: "4px 0 0", fontSize: 28, color: text, fontWeight: 900 }}>
          {form.name || "Admin"}
        </h1>
        <p style={{ margin: "-6px 0 0", color: muted, fontSize: 13 }}>
          Admin Executive - {form.territory || userProfile.zone || "All Regions"}
        </p>

        <div style={{ display: "flex", justifyContent: "center", marginTop: 2 }}>
          <button
            type="button"
            onClick={() => {
              setProfileOpen((prev) => !prev);
              setMessage("");
            }}
            style={{
              border: `1.5px solid ${brand}55`,
              background: "#fff",
              color: brand,
              height: 36,
              padding: "0 20px",
              borderRadius: 999,
              fontWeight: 800,
              cursor: "pointer",
            }}
          >
            Edit Profile
          </button>
        </div>
      </div>

      {message ? (
        <div
          style={{
            marginTop: 14,
            borderRadius: 12,
            border: `1px solid ${message.includes("successfully") ? "#d7f0dc" : "#ffd1d1"}`,
            background: message.includes("successfully") ? "#eef9f0" : "#fff0f0",
            color: message.includes("successfully") ? "#27944e" : "#d42424",
            padding: 12,
            fontSize: 12,
            fontWeight: 800,
          }}
        >
          {message}
        </div>
      ) : null}

      {profileOpen ? (
        <div
          style={{
            marginTop: 16,
            background: card,
            border: `1px solid ${border}`,
            borderRadius: 18,
            padding: 16,
          }}
        >
        <div style={{ display: "grid", gap: 13 }}>
          <Field
            label="Name"
            name="name"
            value={form.name}
            onChange={handleInput}
            placeholder="Admin name"
          />
          <Field
            label="Business Name"
            name="businessName"
            value={form.businessName}
            onChange={handleInput}
            placeholder="Business name"
          />
          <Field
            label="Phone"
            name="phone"
            value={form.phone}
            onChange={handleInput}
            placeholder="10 digit phone"
            type="tel"
          />
          <Field
            label="Territory"
            name="territory"
            value={form.territory}
            onChange={handleInput}
            placeholder="Territory"
          />
        </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 16 }}>
            <button
              type="button"
              onClick={() => {
                setProfileOpen(false);
                setImageFile(null);
                setPreview(userProfile.profileImageUrl || "");
                setForm({
                  name: userProfile.name || "",
                  businessName: userProfile.businessName || "",
                  phone: userProfile.phone || "",
                  territory: userProfile.territory || "",
                });
                setMessage("");
              }}
              disabled={saving}
              style={{
                height: 46,
                border: `1px solid ${border}`,
                borderRadius: 14,
                background: "#fff",
                color: muted,
                fontWeight: 800,
                cursor: saving ? "not-allowed" : "pointer",
              }}
            >
              Cancel
            </button>

            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              style={{
                height: 46,
                border: "none",
                borderRadius: 14,
                background: brand,
                color: "#fff",
                fontWeight: 900,
                cursor: saving ? "not-allowed" : "pointer",
                opacity: saving ? 0.7 : 1,
              }}
            >
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
      </div>
      ) : null}

      <div style={{ marginTop: 22 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 12,
          }}
        >
          <h2 style={{ margin: 0, fontSize: 20, color: text, fontWeight: 900 }}>My Performance</h2>
          <button
            type="button"
            onClick={() => onNavigate?.("sales")}
            style={{
              border: "none",
              background: "transparent",
              color: brand,
              fontWeight: 800,
              cursor: "pointer",
            }}
          >
            Monthly View
          </button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div style={{ background: card, border: `1px solid ${border}`, borderRadius: 16, padding: 14 }}>
            <small style={{ color: muted, fontWeight: 800 }}>Total Sales</small>
            <strong style={{ display: "block", marginTop: 8, fontSize: 18, color: text }}>
              {stats.totalSales || "0"}
            </strong>
            <span style={{ display: "block", marginTop: 6, color: "#27944e", fontSize: 12, fontWeight: 800 }}>
              {stats.orderCount || 0} Orders
            </span>
          </div>

          <div style={{ background: card, border: `1px solid ${border}`, borderRadius: 16, padding: 14 }}>
            <small style={{ color: muted, fontWeight: 800 }}>Inventory Value</small>
            <strong style={{ display: "block", marginTop: 8, fontSize: 18, color: text }}>
              {stats.inventoryValue || "0"}
            </strong>
            <span style={{ display: "block", marginTop: 6, color: brand, fontSize: 12, fontWeight: 800 }}>
              {stats.lowStockCount || 0} Low Stock
            </span>
          </div>
        </div>
      </div>

      <div style={{ marginTop: 18 }}>
        <h2 style={{ margin: "0 0 10px", fontSize: 18, color: text, fontWeight: 900 }}>
          App & Inventory
        </h2>
        <div style={{ display: "grid", gap: 10 }}>
          <ProfileMenuRow
            icon="D"
            title="Dashboard"
            subtitle="Review live business health"
            onClick={() => onNavigate?.("dashboard")}
            accent={brand}
          />
          <ProfileMenuRow
            icon="S"
            title="Sales History"
            subtitle="Track every order and zone"
            onClick={() => onNavigate?.("sales")}
            accent={brand}
          />
          <ProfileMenuRow
            icon="I"
            title="Inventory Control"
            subtitle="Manage stock and pricing"
            onClick={() => onNavigate?.("inventory")}
            accent={brand}
          />
          <ProfileMenuRow
            icon="P"
            title="Product Setup"
            subtitle="Add new SKUs and zones"
            onClick={() => onNavigate?.("products")}
            accent={brand}
          />
        </div>
      </div>

      <div style={{ marginTop: 18 }}>
        <h2 style={{ margin: "0 0 10px", fontSize: 18, color: text, fontWeight: 900 }}>
          Support & Settings
        </h2>
        <ProfileMenuRow
          icon="?"
          title="Help & Support"
          subtitle={userProfile.email || "Admin account support"}
          onClick={() => {}}
          accent={brand}
        />
      </div>

      {onLogout ? (
        <button
          type="button"
          onClick={onLogout}
          style={{
            marginTop: 20,
            width: "100%",
            height: 48,
            borderRadius: 12,
            border: "none",
            background: brand,
            color: "#fff",
            fontWeight: 900,
            cursor: "pointer",
            boxShadow: "0 10px 20px rgba(0,0,0,0.10)",
          }}
        >
          Logout Account
        </button>
      ) : null}
    </>
  );
}
