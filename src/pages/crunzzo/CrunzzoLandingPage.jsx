import { useNavigate } from "react-router-dom";
import "./crunzzo.css";

export default function CrunzzoLandingPage() {
  const navigate = useNavigate();

  return (
    <div className="brand-page">
      <div className="brand-card">
        <h1>Crunzzo Landing Page</h1>
        <p>Landing is working.</p>
        <button onClick={() => navigate("/crunzzo/choose")}>
          Go to Choose Page
        </button>
      </div>
    </div>
  );
}