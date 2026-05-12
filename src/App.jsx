import { Routes, Route, Navigate } from "react-router-dom";

import LandingPage from "./pages/LandingPage";
import ChooseSectionPage from "./pages/ChooseSectionPage";
import LoginPage from "./pages/LoginPage";

import CrunzzoDistributorDashboard from "./pages/crunzzo/CrunzzoDistributorDashboard";
import CrunzzoAdminDashboard from "./pages/crunzzo/CrunzzoAdminDashboard";

import BounceDistributorDashboard from "./pages/bounce/BounceDistributorDashboard";
import BounceAdminDashboard from "./pages/bounce/BounceAdminDashboard";

import ValenciaDistributorDashboard from "./pages/valencia/ValenciaDistributorDashboard";
import ValenciaAdminDashboard from "./pages/valencia/ValenciaAdminDashboard";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/choose-section" element={<ChooseSectionPage />} />
      <Route path="/login" element={<LoginPage />} />

      <Route path="/crunzzo/dashboard" element={<CrunzzoDistributorDashboard />} />
      <Route path="/crunzzo/admin" element={<CrunzzoAdminDashboard />} />

      <Route path="/bounce/dashboard" element={<BounceDistributorDashboard />} />
      <Route path="/bounce/admin" element={<BounceAdminDashboard />} />

      <Route path="/valencia/dashboard" element={<ValenciaDistributorDashboard />} />
      <Route path="/valencia/admin" element={<ValenciaAdminDashboard />} />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}