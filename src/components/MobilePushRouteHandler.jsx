import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

import {
  consumePendingPushRoute,
  setMobilePushNavigator,
} from "../utils/mobilePushNotifications";

export default function MobilePushRouteHandler() {
  const navigate = useNavigate();

  useEffect(() => {
    setMobilePushNavigator((route) => navigate(route));

    const pendingRoute = consumePendingPushRoute();
    if (pendingRoute) {
      navigate(pendingRoute);
    }

    return () => setMobilePushNavigator(null);
  }, [navigate]);

  return null;
}
