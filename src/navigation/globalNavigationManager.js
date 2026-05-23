import { useCallback, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";

const PORTAL_HISTORY_KIND = "portal-navigation";
const PUBLIC_HISTORY_KIND = "public-navigation";
const LOGOUT_MARKER_KEY = "portal_logged_out_at";

function createPortalState(portalKey, screen, rootScreen, guard = false) {
  return {
    kind: PORTAL_HISTORY_KIND,
    portalKey,
    screen,
    rootScreen,
    guard,
    createdAt: Date.now(),
  };
}

function isPortalState(state, portalKey) {
  return state?.kind === PORTAL_HISTORY_KIND && state.portalKey === portalKey;
}

export function routeToChooseSelection(navigate) {
  if (typeof window !== "undefined") {
    const state = {
      kind: PUBLIC_HISTORY_KIND,
      screen: "choose-section",
      loggedOutAt: Date.now(),
    };

    sessionStorage.setItem(LOGOUT_MARKER_KEY, String(state.loggedOutAt));
    window.history.replaceState(state, "", "/choose-section");
  }

  navigate("/choose-section");
}

/**
 * Enhanced Portal History Manager that synchronizes state with URL parameters
 * and handles standard browser back/forward behavior.
 */
export function usePortalHistoryManager({
  portalKey,
  rootScreen,
  currentScreen,
  setScreen,
  onRootBack,
  basePath, // e.g., "/bounce/admin"
}) {
  const { tab } = useParams();
  const navigate = useNavigate();

  const screenRef = useRef(currentScreen);
  const setScreenRef = useRef(setScreen);
  const onRootBackRef = useRef(onRootBack);

  // Sync refs
  useEffect(() => {
    screenRef.current = currentScreen;
  }, [currentScreen]);

  useEffect(() => {
    setScreenRef.current = setScreen;
  }, [setScreen]);

  useEffect(() => {
    onRootBackRef.current = onRootBack;
  }, [onRootBack]);

  // 1. Sync URL Param -> State
  useEffect(() => {
    const nextTab = tab || rootScreen;
    if (nextTab !== currentScreen) {
      setScreen(nextTab);
    }
  }, [tab, rootScreen, setScreen]);

  // 2. Handle History Logic
  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    const currentState = window.history.state;
    const currentUrl = window.location.pathname;

    // Initialize history state if missing or incorrect
    if (!isPortalState(currentState, portalKey) || currentState.screen !== (tab || rootScreen)) {
      window.history.replaceState(
        createPortalState(portalKey, tab || rootScreen, rootScreen, false),
        "",
        currentUrl
      );

      // If we are at the root, push a guard state to intercept "back" and show logout confirm
      if (!tab || tab === rootScreen) {
        window.history.pushState(
          createPortalState(portalKey, rootScreen, rootScreen, true),
          "",
          currentUrl
        );
      }
    }

    const handlePopState = (event) => {
      const activeScreen = screenRef.current;

      // Intercept back from root screen
      if (activeScreen === rootScreen) {
        onRootBackRef.current?.();
        // Re-push guard to stay on page
        window.history.pushState(
          createPortalState(portalKey, rootScreen, rootScreen, true),
          "",
          window.location.pathname
        );
        return;
      }

      // Handle standard back/forward for non-root screens
      if (isPortalState(event.state, portalKey)) {
        const nextScreen = event.state.screen || rootScreen;
        if (nextScreen !== activeScreen) {
           // We let react-router handle the URL change, which triggers the tab sync useEffect
           // But if it's a browser back, URL is already changed.
           // We just need to ensure the state follows.
           setScreenRef.current(nextScreen);
        }
        return;
      }

      // Fallback
      setScreenRef.current(rootScreen);
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [portalKey, rootScreen, tab]);

  // 3. Navigation function (updates URL)
  return useCallback(
    (nextScreen, options = {}) => {
      if (!nextScreen || nextScreen === screenRef.current) return;

      const targetPath = nextScreen === rootScreen ? basePath : `${basePath}/${nextScreen}`;

      if (options.replace) {
        navigate(targetPath, { replace: true });
      } else {
        navigate(targetPath);
      }

      // We also update history state to maintain our portal markers
      const isRoot = nextScreen === rootScreen;
      const state = createPortalState(portalKey, nextScreen, rootScreen, isRoot);
      const method = options.replace || isRoot ? "replaceState" : "pushState";

      if (typeof window !== "undefined") {
        window.history[method](state, "", targetPath);
      }
    },
    [basePath, navigate, portalKey, rootScreen]
  );
}
