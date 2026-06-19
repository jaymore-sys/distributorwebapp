import { Routes, Route, Navigate } from "react-router-dom";

import LandingPage from "./pages/LandingPage";
import ChooseSectionPage from "./pages/ChooseSectionPage";
import LoginPage from "./pages/LoginPage";

import CrunzzoDistributorDashboard from "./pages/crunzzo/CrunzzoDistributorDashboard";
import CrunzzoRetailerDashboard from "./pages/crunzzo/CrunzzoRetailerDashboard";
import CrunzzoAdminDashboard from "./pages/crunzzo/CrunzzoAdminDashboard";
import CrunzzoSuperStockistDashboard from "./pages/crunzzo/CrunzzoSuperStockistDashboard";

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

      <Route path="/crunzzo/distributor/:tab?" element={<CrunzzoDistributorDashboard />} />
      <Route path="/crunzzo/retailer/:tab?" element={<CrunzzoRetailerDashboard />} />
      <Route path="/crunzzo/admin/:tab?" element={<CrunzzoAdminDashboard />} />
      <Route path="/crunzzo/super-stockist/:tab?" element={<CrunzzoSuperStockistDashboard />} />

      <Route path="/bounce/distributor/:tab?" element={<BounceDistributorDashboard />} />
      <Route path="/bounce/admin/:tab?" element={<BounceAdminDashboard />} />

      <Route path="/valencia/distributor/:tab?" element={<ValenciaDistributorDashboard />} />
      <Route path="/valencia/admin/:tab?" element={<ValenciaAdminDashboard />} />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
