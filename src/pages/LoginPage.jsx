import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  createUserWithEmailAndPassword,
  deleteUser,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  GoogleAuthProvider,
  signInWithPopup,
} from "firebase/auth";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";

import { getFirebaseServices, setSelectedBackend } from "../firebase";
import { CRUNZZO_REGIONS, normalizeCrunzzoRegion } from "../utils/crunzzoRegions";

import valenciaLogo from "../assets/drink-valencia-logo.jpg";
import bounceLogo from "../assets/9aaf616a1f05b52baba7f0d12dcc6600408fd0e3 (1).png";
import crunzzoLogo from "../assets/crunzzologo.png";
import landingHero from "../assets/landing-hero.png";
import "./login.css";

function getErrorMessage(error) {
  switch (error.code) {
    case "auth/invalid-credential":
      return "Invalid email or password.";
    case "auth/user-not-found":
      return "User not found.";
    case "auth/wrong-password":
      return "Wrong password.";
    case "auth/email-already-in-use":
      return "This email is already in use.";
    case "auth/invalid-email":
      return "Please enter a valid email address.";
    case "auth/weak-password":
      return "Password should be at least 6 characters.";
    case "auth/too-many-requests":
      return "Too many attempts. Please try again later.";
    case "auth/missing-email":
      return "Please enter your email first.";
    case "auth/operation-not-allowed":
      return "Email/password sign-in is not enabled in Firebase.";
    case "permission-denied":
      return "Firestore denied profile creation. Update Firestore Rules first.";
    case "failed-precondition":
      return "Firestore database is not enabled yet. Create Firestore first.";
    default:
      return error.message || "Something went wrong. Please try again.";
  }
}

function GoogleIcon() {
  return (
    <svg className="crz-social-svg" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.49 12.27c0-.79-.07-1.55-.2-2.27H12v4.3h6.44a5.5 5.5 0 0 1-2.39 3.61v3h3.86c2.26-2.08 3.58-5.14 3.58-8.64z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.96-1.07 7.95-2.91l-3.86-3c-1.07.72-2.44 1.15-4.09 1.15-3.14 0-5.79-2.12-6.74-4.96H1.27v3.09A12 12 0 0 0 12 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.26 14.28A7.2 7.2 0 0 1 4.88 12c0-.79.14-1.55.38-2.28V6.63H1.27A12 12 0 0 0 0 12c0 1.93.46 3.76 1.27 5.37l3.99-3.09z"
      />
      <path
        fill="#EA4335"
        d="M12 4.77c1.76 0 3.34.61 4.58 1.8l3.44-3.44C17.95 1.2 15.23 0 12 0A12 12 0 0 0 1.27 6.63l3.99 3.09c.95-2.84 3.6-4.95 6.74-4.95z"
      />
    </svg>
  );
}



const brandMap = {
  valencia: {
    label: "Drink Valencia",
    logo: valenciaLogo,
    hero: landingHero,
    accent: "orange",
    backend: "valencia",
  },
  bounce: {
    label: "Bounce Superdrinks",
    logo: bounceLogo,
    hero: landingHero,
    accent: "blue",
    backend: "bounce",
  },
  crunzzo: {
    label: "Crunzzo",
    logo: crunzzoLogo,
    hero: landingHero,
    accent: "red",
    backend: "crunzzo",
  },
};

const initialLoginData = {
  email: "",
  password: "",
};

const initialSignupData = {
  fullName: "",
  businessName: "",
  phone: "",
  region: "Chennai",
  email: "",
  password: "",
  confirmPassword: "",
};

function BackIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}

export default function LoginPage({ setUserProfile }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const sectionKey = (searchParams.get("section") || "crunzzo").toLowerCase();
  const selectedBrand = brandMap[sectionKey] || brandMap.crunzzo;
  const { auth, db } = getFirebaseServices(selectedBrand.backend);

  const [mode, setMode] = useState("login");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [infoMessage, setInfoMessage] = useState("");

  const [loginData, setLoginData] = useState(initialLoginData);
  const [signupData, setSignupData] = useState(initialSignupData);

  useEffect(() => {
    setSelectedBackend(selectedBrand.backend);
  }, [selectedBrand.backend]);

  const handleLoginChange = (e) => {
    const { name, value } = e.target;
    setError("");
    setInfoMessage("");
    setLoginData((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleSignupChange = (e) => {
    const { name, value } = e.target;
    let finalValue = value;

    if (name === "phone") {
      finalValue = value.replace(/\D/g, "").slice(0, 10);
    } else if (name === "fullName" || name === "businessName") {
      finalValue = value.replace(/[0-9]/g, "");
    }

    setError("");
    setInfoMessage("");
    setSignupData((prev) => ({
      ...prev,
      [name]: finalValue,
    }));
  };

  const goByRole = (profile) => {
    if (profile.role === "admin") {
      navigate(`/${sectionKey}/admin`, { replace: true });
      return;
    }

    if (profile.role === "super_stockist" && sectionKey === "crunzzo") {
      navigate("/crunzzo/super-stockist", { replace: true });
      return;
    }

    navigate(`/${sectionKey}/distributor`, { replace: true });
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setError("");
    setInfoMessage("");

    const email = loginData.email.trim();
    const password = loginData.password.trim();

    if (!email || !password) {
      setError("Please enter both email and password.");
      return;
    }

    try {
      setLoading(true);
      setSelectedBackend(selectedBrand.backend);

      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      const loggedInUser = userCredential.user;

      const userRef = doc(db, "users", loggedInUser.uid);
      const userSnap = await getDoc(userRef);

      if (!userSnap.exists()) {
        setError("User profile not found in Firestore.");
        await signOut(auth);
        return;
      }

      const profileData = userSnap.data();

      if (!profileData.role) {
        setError("This account has no valid role.");
        await signOut(auth);
        return;
      }

      if (profileData.role === "super_stockist" && sectionKey !== "crunzzo") {
        setError("Super Stockist accounts are only available for Crunzzo.");
        await signOut(auth);
        return;
      }

      const finalProfile = {
        uid: loggedInUser.uid,
        email: loggedInUser.email,
        ...profileData,
      };

      if (setUserProfile) {
        setUserProfile(finalProfile);
      }

      goByRole(finalProfile);
    } catch (err) {
      console.error("Login error:", err);
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const handleSignup = async (e) => {
    e.preventDefault();
    setError("");
    setInfoMessage("");

    const fullName = signupData.fullName.trim();
    const businessName = signupData.businessName.trim();
    const phone = signupData.phone.trim();
    const region = normalizeCrunzzoRegion(signupData.region, "");
    const email = signupData.email.trim();
    const password = signupData.password.trim();
    const confirmPassword = signupData.confirmPassword.trim();

    if (!fullName || !businessName || !phone || !email || !password || !confirmPassword) {
      setError("Please fill all sign up fields.");
      return;
    }

    if (!/^\d{10}$/.test(phone)) {
      setError("Phone number must be exactly 10 digits.");
      return;
    }

    if (sectionKey === "crunzzo" && !region) {
      setError("Please select a Crunzzo region.");
      return;
    }

    if (password.length < 6) {
      setError("Password should be at least 6 characters.");
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    let createdUser = null;

    try {
      setLoading(true);
      setSelectedBackend(selectedBrand.backend);

      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      createdUser = userCredential.user;

      await updateProfile(createdUser, {
        displayName: fullName,
      });

      const distributorId = `DIST-${createdUser.uid.slice(0, 6).toUpperCase()}`;

      const firestorePayload = {
        name: fullName,
        businessName,
        phone,
        role: "distributor",
        distributorId,
        status: "active",
        section: sectionKey,
        createdAt: serverTimestamp(),
      };

      if (sectionKey === "crunzzo") {
        firestorePayload.region = region;
      }

      await setDoc(doc(db, "users", createdUser.uid), firestorePayload);

      await signOut(auth);

      if (setUserProfile) {
        setUserProfile(null);
      }

      setSignupData(initialSignupData);
      setLoginData({
        email,
        password: "",
      });
      setMode("login");
      setInfoMessage("Account created successfully. Please log in.");
    } catch (err) {
      console.error("Signup error:", err);

      if (createdUser) {
        try {
          await deleteUser(createdUser);
        } catch (deleteErr) {
          console.error("Cleanup delete user failed:", deleteErr);
        }
      }

      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    setError("");
    setInfoMessage("");

    const email = loginData.email.trim();

    if (!email) {
      setError("Enter your email first to reset password.");
      return;
    }

    try {
      setLoading(true);
      setSelectedBackend(selectedBrand.backend);
      await sendPasswordResetEmail(auth, email);
      setInfoMessage(`Password reset email sent to ${email}`);
    } catch (err) {
      console.error("Forgot password error:", err);
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setError("");
    setInfoMessage("");

    try {
      setLoading(true);
      // Ensure we are using the correct backend before auth
      setSelectedBackend(selectedBrand.backend);

      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });

      const result = await signInWithPopup(auth, provider);
      const user = result.user;

      // Check if user exists in the specific backend's Firestore
      const userRef = doc(db, "users", user.uid);
      const userSnap = await getDoc(userRef);

      if (!userSnap.exists()) {
        setError("Account not found. Please create an account first.");
        await signOut(auth);
        return;
      }

      const profileData = userSnap.data();

      if (profileData.role === "super_stockist" && sectionKey !== "crunzzo") {
        setError("Super Stockist accounts are only available for Crunzzo.");
        await signOut(auth);
        return;
      }

      const finalProfile = {
        uid: user.uid,
        email: user.email,
        ...profileData,
      };

      if (setUserProfile) {
        setUserProfile(finalProfile);
      }

      goByRole(finalProfile);
    } catch (err) {
      console.error("Google login error:", err);
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={`crz-auth-page ${selectedBrand.accent}`}>
      <div className="crz-auth-card">
        <button
          type="button"
          className="crz-back-btn"
          onClick={() => navigate("/choose-section")}
          aria-label="Back to Section Selection"
        >
          <BackIcon />
        </button>

        <div className="crz-top-hero">
          <img
            src={selectedBrand.hero}
            alt={`${selectedBrand.label} hero`}
            className="crz-top-hero-image"
          />
        </div>

        <div className="crz-brand-row">
          <img
            src={selectedBrand.logo}
            alt={selectedBrand.label}
            className="crz-brand-logo-image"
          />
        </div>

        <div className="crz-welcome-copy">
          <p>Welcome back to {selectedBrand.label}!</p>
        </div>

        {mode === "login" ? (
          <form onSubmit={handleLogin} className="crz-form">
            <div className="crz-field">
              <label>Email or Username</label>
              <input
                type="email"
                name="email"
                placeholder="Enter your email"
                value={loginData.email}
                onChange={handleLoginChange}
              />
            </div>

            <div className="crz-field">
              <div className="crz-password-row">
                <label>Password</label>
                <button
                  type="button"
                  className="crz-forgot-btn"
                  onClick={handleForgotPassword}
                  disabled={loading}
                >
                  Forget Password?
                </button>
              </div>

              <input
                type="password"
                name="password"
                placeholder="••••••••••"
                value={loginData.password}
                onChange={handleLoginChange}
              />
            </div>

            {error ? <div className="crz-error">{error}</div> : null}
            {infoMessage ? (
              <div
                style={{
                  background: "#eef9f0",
                  color: "#27944e",
                  border: "1px solid #d7f0dc",
                  borderRadius: "12px",
                  padding: "10px 12px",
                  fontSize: "13px",
                  fontWeight: 700,
                  marginBottom: "12px",
                }}
              >
                {infoMessage}
              </div>
            ) : null}

            <button type="submit" className="crz-login-btn" disabled={loading}>
              {loading ? "Logging in..." : "Login"}
            </button>

            <div className="crz-divider">
              <span>or continue with</span>
            </div>

            <div className="crz-social-stack">
              <button
                type="button"
                className="crz-social-btn"
                onClick={handleGoogleLogin}
                disabled={loading}
              >
                <GoogleIcon />
                <span>Login with Google</span>
              </button>


            </div>
          </form>
        ) : (
          <form onSubmit={handleSignup} className="crz-form">
            <div className="crz-field">
              <label>Full Name</label>
              <input
                type="text"
                name="fullName"
                placeholder="Enter full name"
                value={signupData.fullName}
                onChange={handleSignupChange}
              />
            </div>

            <div className="crz-field">
              <label>Business Name</label>
              <input
                type="text"
                name="businessName"
                placeholder="Enter business name"
                value={signupData.businessName}
                onChange={handleSignupChange}
              />
            </div>

            <div className="crz-field">
              <label>Phone Number</label>
              <input
                type="tel"
                name="phone"
                inputMode="numeric"
                maxLength={10}
                placeholder="Enter 10 digit phone number"
                value={signupData.phone}
                onChange={handleSignupChange}
              />
            </div>

            {sectionKey === "crunzzo" ? (
              <div className="crz-field">
                <label>Region</label>
                <select
                  name="region"
                  value={signupData.region}
                  onChange={handleSignupChange}
                >
                  {CRUNZZO_REGIONS.map((region) => (
                    <option key={region.id} value={region.name}>
                      {region.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}

            <div className="crz-field">
              <label>Email</label>
              <input
                type="email"
                name="email"
                placeholder="Enter email"
                value={signupData.email}
                onChange={handleSignupChange}
              />
            </div>

            <div className="crz-field">
              <label>Password</label>
              <input
                type="password"
                name="password"
                placeholder="Create password"
                value={signupData.password}
                onChange={handleSignupChange}
              />
            </div>

            <div className="crz-field">
              <label>Confirm Password</label>
              <input
                type="password"
                name="confirmPassword"
                placeholder="Confirm password"
                value={signupData.confirmPassword}
                onChange={handleSignupChange}
              />
            </div>

            {error ? <div className="crz-error">{error}</div> : null}
            {infoMessage ? (
              <div
                style={{
                  background: "#eef9f0",
                  color: "#27944e",
                  border: "1px solid #d7f0dc",
                  borderRadius: "12px",
                  padding: "10px 12px",
                  fontSize: "13px",
                  fontWeight: 700,
                  marginBottom: "12px",
                }}
              >
                {infoMessage}
              </div>
            ) : null}

            <button type="submit" className="crz-login-btn" disabled={loading}>
              {loading ? "Creating..." : "Sign up"}
            </button>
          </form>
        )}

        <div className="crz-bottom-switch">
          {mode === "login" ? (
            <>
              <span>Don’t have an account?</span>
              <button
                type="button"
                className="crz-bottom-link"
                onClick={() => {
                  setMode("signup");
                  setError("");
                  setInfoMessage("");
                }}
              >
                Sign up
              </button>
            </>
          ) : (
            <>
              <span>Already have an account?</span>
              <button
                type="button"
                className="crz-bottom-link"
                onClick={() => {
                  setMode("login");
                  setError("");
                  setInfoMessage("");
                }}
              >
                Login
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
