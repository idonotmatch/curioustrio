import { createContext, useContext, useState, useEffect } from 'react';
import { AppState } from 'react-native';

const MonthContext = createContext(null);

const currentMonth = () => new Date().toISOString().slice(0, 7);

export function MonthProvider({ children }) {
  const [selectedMonth, setSelectedMonth] = useState(currentMonth);

  // Reset to current month whenever the app comes back to the foreground.
  useEffect(() => {
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') setSelectedMonth(currentMonth());
    });
    return () => sub.remove();
  }, []);

  return (
    <MonthContext.Provider value={{ selectedMonth, setSelectedMonth }}>
      {children}
    </MonthContext.Provider>
  );
}

export function useMonth() {
  return useContext(MonthContext);
}
