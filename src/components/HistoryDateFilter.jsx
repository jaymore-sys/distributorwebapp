import { useState, useRef, useEffect, useCallback } from "react";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const SHORT_DAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

function isSameDay(a, b) {
  if (!a || !b) return false;
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function isDateInRange(date, start, end) {
  if (!date || !start || !end) return false;
  return date >= start && date <= end;
}

function CalendarIcon({ size = 16 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

function ChevronDown({ size = 14 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function CheckIcon({ size = 15 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="5 12 10 17 19 8" />
    </svg>
  );
}

/**
 * HistoryDateFilter - Dropdown-style filter with All, Today, Week, Month, and Custom Range.
 */
export default function HistoryDateFilter({
  historyFilter,
  setHistoryFilter,
  startDate,
  setStartDate,
  endDate,
  setEndDate,
  accentColor = "#ef6a1d",
}) {
  const [open, setOpen] = useState(false);
  const [showCalendar, setShowCalendar] = useState(false);
  const dropdownRef = useRef(null);

  const closeAll = useCallback(() => {
    setOpen(false);
    setShowCalendar(false);
  }, []);

  // Close on outside click
  useEffect(() => {
    function handleOutside(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        closeAll();
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleOutside);
      return () => document.removeEventListener("mousedown", handleOutside);
    }
  }, [open, closeAll]);

  const presets = [
    { key: "all", label: "All Time", icon: "📊" },
    { key: "today", label: "Today", icon: "📅" },
    { key: "week", label: "This Week", icon: "📆" },
    { key: "month", label: "This Month", icon: "🗓" },
  ];

  const handlePreset = (key) => {
    setHistoryFilter(key);
    setStartDate(null);
    setEndDate(null);
    closeAll();
  };

  const handleRangeSelect = (date) => {
    if (!startDate || (startDate && endDate)) {
      setStartDate(date);
      setEndDate(null);
    } else {
      if (date < startDate) {
        setStartDate(date);
        setEndDate(startDate);
      } else {
        setEndDate(date);
      }
      setHistoryFilter("date");
      // Don't close immediately so user sees the selection
      setTimeout(() => closeAll(), 600);
    }
  };

  // Current display label for the dropdown trigger
  const getDisplayLabel = () => {
    if (historyFilter === "date" && startDate) {
      const startStr = startDate.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
      if (!endDate) return `${startStr} - ...`;
      const endStr = endDate.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" });
      return `${startStr} - ${endStr}`;
    }
    const match = presets.find((p) => p.key === historyFilter);
    return match ? match.label : "All Time";
  };

  return (
    <div
      ref={dropdownRef}
      style={{
        margin: "16px 16px 8px",
        position: "relative",
        zIndex: 100,
      }}
    >
      {/* ── Dropdown Trigger ── */}
      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v);
          if (open) setShowCalendar(false);
        }}
        style={{
          width: "100%",
          height: 48,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          padding: "0 16px",
          border: open ? `2px solid ${accentColor}` : "2px solid #e0e4eb",
          borderRadius: 14,
          background: "#fff",
          cursor: "pointer",
          fontFamily: "inherit",
          transition: "all 0.2s ease",
          boxShadow: open ? `0 0 0 3px ${accentColor}18` : "none",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div
            style={{
              width: 30,
              height: 30,
              borderRadius: 9,
              background: `${accentColor}14`,
              color: accentColor,
              display: "grid",
              placeItems: "center",
              flexShrink: 0,
            }}
          >
            <CalendarIcon size={15} />
          </div>
          <div style={{ textAlign: "left" }}>
            <div
              style={{
                fontSize: 10,
                fontWeight: 700,
                color: "#9aa3b2",
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                lineHeight: 1,
                marginBottom: 2,
              }}
            >
              Filter by
            </div>
            <div
              style={{
                fontSize: 14,
                fontWeight: 800,
                color: "#20263a",
                lineHeight: 1.2,
              }}
            >
              {getDisplayLabel()}
            </div>
          </div>
        </div>

        <div
          style={{
            color: "#9aa3b2",
            transition: "transform 0.2s ease",
            transform: open ? "rotate(180deg)" : "rotate(0deg)",
          }}
        >
          <ChevronDown />
        </div>
      </button>

      {/* ── Dropdown Panel ── */}
      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            left: 0,
            right: 0,
            background: "#fff",
            border: "1px solid #e0e4eb",
            borderRadius: 16,
            boxShadow: "0 16px 48px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.06)",
            overflow: "hidden",
            animation: "hdfDropIn 0.18s ease",
            zIndex: 200,
          }}
        >
          <style>{`
            @keyframes hdfDropIn {
              from { opacity: 0; transform: translateY(-8px); }
              to   { opacity: 1; transform: translateY(0); }
            }
          `}</style>

          <div style={{ padding: "8px 6px" }}>
            {presets.map((p) => {
              const isActive = historyFilter === p.key;
              return (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => handlePreset(p.key)}
                  style={{
                    width: "100%",
                    height: 44,
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "0 12px",
                    border: "none",
                    borderRadius: 10,
                    background: isActive ? `${accentColor}10` : "transparent",
                    cursor: "pointer",
                    fontFamily: "inherit",
                    transition: "background 0.15s ease",
                  }}
                >
                  <span style={{ fontSize: 16, width: 24, textAlign: "center" }}>{p.icon}</span>
                  <span
                    style={{
                      flex: 1,
                      textAlign: "left",
                      fontSize: 14,
                      fontWeight: isActive ? 800 : 600,
                      color: isActive ? accentColor : "#20263a",
                    }}
                  >
                    {p.label}
                  </span>
                  {isActive && (
                    <span style={{ color: accentColor, display: "grid", placeItems: "center" }}>
                      <CheckIcon />
                    </span>
                  )}
                </button>
              );
            })}

            <div style={{ height: 1, background: "#eef1f5", margin: "6px 12px" }} />

            <button
              type="button"
              onClick={() => setShowCalendar((v) => !v)}
              style={{
                width: "100%",
                height: 44,
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "0 12px",
                border: "none",
                borderRadius: 10,
                background: historyFilter === "date" ? `${accentColor}10` : showCalendar ? "#f5f6f9" : "transparent",
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              <span style={{ width: 24, textAlign: "center", color: historyFilter === "date" ? accentColor : "#556177", display: "grid", placeItems: "center" }}>
                <CalendarIcon size={16} />
              </span>
              <span style={{ flex: 1, textAlign: "left", fontSize: 14, fontWeight: historyFilter === "date" ? 800 : 600, color: historyFilter === "date" ? accentColor : "#20263a" }}>
                {historyFilter === "date" && startDate ? getDisplayLabel() : "Custom Range"}
              </span>
              <span style={{ color: "#9aa3b2", transform: showCalendar ? "rotate(180deg)" : "rotate(0deg)", display: "grid", placeItems: "center" }}>
                <ChevronDown size={12} />
              </span>
            </button>
          </div>

          {showCalendar && (
            <MiniCalendarInline
              startDate={startDate}
              endDate={endDate}
              onSelect={handleRangeSelect}
              accentColor={accentColor}
            />
          )}
        </div>
      )}
    </div>
  );
}

function MiniCalendarInline({ startDate, endDate, onSelect, accentColor }) {
  const today = new Date();
  const [viewYear, setViewYear] = useState((startDate || today).getFullYear());
  const [viewMonth, setViewMonth] = useState((startDate || today).getMonth());

  const prevMonth = () => { viewMonth === 0 ? (setViewMonth(11), setViewYear(y => y-1)) : setViewMonth(m => m-1); };
  const nextMonth = () => { viewMonth === 11 ? (setViewMonth(0), setViewYear(y => y+1)) : setViewMonth(m => m+1); };

  const firstDay = new Date(viewYear, viewMonth, 1);
  let startDow = firstDay.getDay();
  startDow = startDow === 0 ? 6 : startDow - 1;

  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const accent = accentColor || "#ef6a1d";

  return (
    <div style={{ borderTop: "1px solid #eef1f5", padding: "14px 14px 16px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <button type="button" onClick={prevMonth} style={{ width: 30, height: 30, border: "1px solid #e4e8f0", borderRadius: 8, background: "#fafbfc", cursor: "pointer" }}>‹</button>
        <span style={{ fontWeight: 800, fontSize: 13, color: "#20263a" }}>{MONTHS[viewMonth]} {viewYear}</span>
        <button type="button" onClick={nextMonth} style={{ width: 30, height: 30, border: "1px solid #e4e8f0", borderRadius: 8, background: "#fafbfc", cursor: "pointer" }}>›</button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2, marginBottom: 4 }}>
        {SHORT_DAYS.map(d => <div key={d} style={{ textAlign: "center", fontSize: 10, fontWeight: 700, color: "#9aa3b2" }}>{d}</div>)}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2 }}>
        {cells.map((day, idx) => {
          if (day === null) return <div key={`e-${idx}`} />;
          const cellDate = new Date(viewYear, viewMonth, day);
          const isToday = isSameDay(cellDate, today);
          const isStart = isSameDay(cellDate, startDate);
          const isEnd = isSameDay(cellDate, endDate);
          const inRange = startDate && endDate && cellDate > startDate && cellDate < endDate;
          const isFuture = cellDate.getTime() > new Date().setHours(23, 59, 59, 999);

          return (
            <button
              key={day}
              type="button"
              disabled={isFuture}
              onClick={() => onSelect(cellDate)}
              style={{
                width: "100%",
                aspectRatio: "1",
                border: isToday && !isStart && !isEnd ? `2px solid ${accent}` : "2px solid transparent",
                borderRadius: inRange ? 0 : 10,
                background: (isStart || isEnd) ? accent : inRange ? `${accent}22` : "transparent",
                color: (isStart || isEnd) ? "#fff" : inRange ? accent : isFuture ? "#d0d5dd" : isToday ? accent : "#20263a",
                fontWeight: (isStart || isEnd || isToday) ? 800 : 600,
                fontSize: 12,
                cursor: isFuture ? "not-allowed" : "pointer",
                display: "grid",
                placeItems: "center",
                transition: "all 0.12s ease",
              }}
            >
              {day}
            </button>
          );
        })}
      </div>

      {startDate && (
        <button
          type="button"
          onClick={() => { onSelect(null); onSelect(today); }}
          style={{ width: "100%", height: 32, marginTop: 10, border: `1px solid ${accent}`, borderRadius: 8, background: "transparent", color: accent, fontWeight: 700, fontSize: 12, cursor: "pointer" }}
        >
          Reset Selection
        </button>
      )}
    </div>
  );
}

export function getFilterLabel(historyFilter, startDate, endDate) {
  if (historyFilter === "date" && startDate) {
    const s = startDate.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
    if (!endDate) return `Sales from ${s}`;
    const e = endDate.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
    return `Sales from ${s} to ${e}`;
  }
  if (historyFilter === "today") return "Total Sales Today";
  if (historyFilter === "week") return "Total Sales This Week";
  if (historyFilter === "month") return "Total Sales This Month";
  return "Total Sales (All Time)";
}

export function getFilterHeading(historyFilter, startDate, endDate) {
  if (historyFilter === "date" && startDate) {
    const s = startDate.toLocaleDateString("en-IN", { day: "2-digit", month: "short" }).toUpperCase();
    if (!endDate) return `FROM ${s}`;
    const e = endDate.toLocaleDateString("en-IN", { day: "2-digit", month: "short" }).toUpperCase();
    return `${s} ➜ ${e}`;
  }
  if (historyFilter === "today") return "TODAY";
  if (historyFilter === "week") return "THIS WEEK";
  if (historyFilter === "month") return "THIS MONTH";
  return "ALL ACTIVITY";
}
