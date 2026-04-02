import { createContext, useContext, useState, useEffect } from 'react';
import { AppState } from 'react-native';

const MonthContext = createContext(null);

// Given a budget start day, return the YYYY-MM period key that contains today.
// e.g. startDay=15, today=Apr 10 → period started Mar 15 → '2026-03'
// e.g. startDay=15, today=Apr 20 → period started Apr 15 → '2026-04'
export function currentPeriod(startDay = 1) {
  const now = new Date();
  if (now.getDate() >= startDay) {
    return now.toISOString().slice(0, 7);
  }
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return prev.toISOString().slice(0, 7);
}

// Human-readable label for a period.
// Calendar month (day=1): "April 2026"
// Custom (day=15):        "Apr 15 – May 14"
export function periodLabel(month, startDay = 1) {
  const [year, mon] = month.split('-').map(Number);
  if (startDay === 1) {
    return new Date(year, mon - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  }
  const SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const toDate = new Date(year, mon, startDay - 1);
  return `${SHORT[mon - 1]} ${startDay} – ${SHORT[toDate.getMonth()]} ${toDate.getDate()}`;
}

export function MonthProvider({ children }) {
  const [startDay, setStartDay] = useState(1);
  const [selectedMonth, setSelectedMonth] = useState(() => currentPeriod(1));

  // Reset to current period on foreground — uses latest startDay.
  useEffect(() => {
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') setSelectedMonth(currentPeriod(startDay));
    });
    return () => sub.remove();
  }, [startDay]);

  return (
    <MonthContext.Provider value={{ selectedMonth, setSelectedMonth, startDay, setStartDay }}>
      {children}
    </MonthContext.Provider>
  );
}

export function useMonth() {
  return useContext(MonthContext);
}
