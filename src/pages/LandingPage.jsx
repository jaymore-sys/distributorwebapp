import { useNavigate } from "react-router-dom";
import valenciaLogo from "../assets/valencia-logo.png";
import landingHero from "../assets/landing-hero.png";
import "../entry.css";

export default function LandingPage() {
  const navigate = useNavigate();

  return (
    <div className="entry-page">
      <div className="entry-shell landing-shell">
        <div className="landing-top">
          <img
            src={valenciaLogo}
            alt="Valencia Nutrition"
            className="landing-brand-logo"
          />
        </div>

        <div className="landing-hero-wrap">
          <img
            src={landingHero}
            alt="Valencia Nutrition hero"
            className="landing-hero-image"
          />
        </div>

        <div className="landing-bottom">
          <button
            type="button"
            className="landing-primary-btn"
            onClick={() => navigate("/choose-section")}
          >
            Get Started <span>→</span>
          </button>
        </div>
      </div>
    </div>
  );
}