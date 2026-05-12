import { useNavigate } from "react-router-dom";
import "./crunzzo.css";

export default function CrunzzoChoosePage() {
  const navigate = useNavigate();

  return (
    <div className="brand-page">
      <div className="brand-card">
        <h1>Crunzzo Choose Page</h1>
        <p>Choose page is working.</p>
        <button onClick={() => navigate("/crunzzo/login")}>
          Go to Login
        </button>
      </div>
    </div>
  );
}