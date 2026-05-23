import { useNavigate } from "react-router-dom";
import valenciaLogo from "../assets/drink-valencia-logo.jpg";
import bounceLogo from "../assets/9aaf616a1f05b52baba7f0d12dcc6600408fd0e3 (1).png";
import crunzzoLogo from "../assets/crunzzologo.png";
import "../entry.css";

const sectionCards = [
  {
    id: "valencia",
    title: "Valencia",
    subtitle: "Premium Hydration",
    description: "Access high-end hydration metrics, distribution channels, and regional performance data.",
    theme: "orange",
    logo: valenciaLogo,
  },
  {
    id: "bounce",
    title: "Bounce",
    subtitle: "Energy Drinks",
    description: "Manage energy line sales targets, promotional campaigns, and retailer stock levels.",
    theme: "blue",
    logo: bounceLogo,
  },
  {
    id: "crunzzo",
    title: "Crunzzo",
    subtitle: "Snack Foods",
    description: "Review snack division logistics, vendor relationships, and quarterly sales volume.",
    theme: "red",
    logo: crunzzoLogo,
  },
];

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

export default function ChooseSectionPage() {
  const navigate = useNavigate();

  return (
    <div className="entry-page">
      <div className="entry-shell section-shell">
        <div className="section-page-head">
          <button
            type="button"
            className="section-head-back"
            onClick={() => navigate("/")}
            aria-label="Back"
          >
            <BackIcon />
          </button>
          <h1>Sales Dashboard</h1>
        </div>

        <div className="section-cards">
          {sectionCards.map((card) => (
            <div className="section-card" key={card.id}>
              <div className="section-card-top">
                <div className="section-logo-box">
                  <img
                    src={card.logo}
                    alt={card.title}
                    className="section-logo-image"
                  />
                </div>

                <div className="section-card-copy">
                  <h3>{card.title}</h3>
                  <p className="section-card-subtitle">{card.subtitle}</p>
                </div>
              </div>

              <p className="section-card-description">{card.description}</p>

              <button
                type="button"
                className={`section-login-btn ${card.theme}`}
                onClick={() => navigate(`/login?section=${card.id}`)}
              >
                Login
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
