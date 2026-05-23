import { useNavigate } from "react-router-dom";
import "./crunzzo.css";

export default function CrunzzoLoginPage() {
  const navigate = useNavigate();

  return (
    <div className="brand-page">
      <div className="brand-card">
        <h1>Crunzzo Login Page</h1>
        <p>Login page is working.</p>

        <div className="button-group">
          <button onClick={() => navigate("/crunzzo/distributor")}>
            Login as Distributor
          </button>
          <button onClick={() => navigate("/crunzzo/admin")}>
            Login as Admin
          </button>
        </div>
      </div>
    </div>
  );
}