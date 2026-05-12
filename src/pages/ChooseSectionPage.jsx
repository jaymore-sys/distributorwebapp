import { useNavigate } from "react-router-dom";
import valenciaLogo from "../assets/05547902525dba681f4006d28f9e8e20b12b1f5b (1).jpg";
import bounceLogo from "../assets/9aaf616a1f05b52baba7f0d12dcc6600408fd0e3 (1).png";
import crunzzoLogo from "../assets/crunzzologo.png";
import "../entry.css";

const sectionCards = [
  {
    id: "valencia",
    title: "Drink Valencia",
    status: "Active",
    statusClass: "active",
    theme: "orange",
    logo: valenciaLogo,
    logoAlt: "Drink Valencia",
  },
  {
    id: "bounce",
    title: "Bounce Superdrinks",
    status: "Stable",
    statusClass: "stable",
    theme: "blue",
    logo: bounceLogo,
    logoAlt: "Bounce Superdrinks",
    logoClass: "bounce-large",
  },
  {
    id: "crunzzo",
    title: "Crunzzo",
    status: "Critical Stock",
    statusClass: "critical",
    theme: "red",
    logo: crunzzoLogo,
    logoAlt: "Crunzzo",
  },
];

function BellIcon() {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M15 17h5l-1.4-1.4a2 2 0 0 1-.6-1.4V11a6 6 0 1 0-12 0v3.2a2 2 0 0 1-.6 1.4L4 17h5" />
      <path d="M9.5 17a2.5 2.5 0 0 0 5 0" />
    </svg>
  );
}

export default function ChooseSectionPage() {
  const navigate = useNavigate();

  return (
    <div className="entry-page">
      <div className="entry-shell section-shell">
        <div className="section-page-head">
          <div>
            <h1>Sales Dashboard</h1>
            <p>VALENCIA NUTRITION LTD.</p>
          </div>

          <button
            type="button"
            className="section-head-bell"
            aria-label="Notifications"
          >
            <BellIcon />
          </button>
        </div>

        <div className="section-cards">
          {sectionCards.map((card) => (
            <div className="section-card" key={card.id}>
              <div className="section-card-top">
                <div className={`section-logo-box ${card.theme}`}>
                  <img
                    src={card.logo}
                    alt={card.logoAlt}
                    className={`section-logo-image ${card.logoClass || ""}`}
                  />
                </div>

                <div className="section-card-copy">
                  <h3>{card.title}</h3>
                  <span className={`section-status ${card.statusClass}`}>
                    {card.status}
                  </span>
                </div>
              </div>

              <div className="section-mini-actions">
                <button type="button">View Inventory</button>
                <button type="button">Add New Sale</button>
                <button
                  type="button"
                  className={`manage-btn ${card.theme}`}
                >
                  Manage Sales
                </button>
              </div>

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