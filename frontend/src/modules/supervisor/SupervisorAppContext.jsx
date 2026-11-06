import React, { createContext, useContext, useState, useEffect } from 'react';
import { api } from '../../api/client.js';

const SupervisorAppContext = createContext(null);

const TRANSLATIONS = {
  en: {
    app_title: 'Udgam Supervisor',
    home: 'Home',
    today_due: 'Today Due',
    today_collected: 'Today Collected',
    new_member: 'New Member',
    new_member_report: 'Member Report',
    npa_recovery: 'NPA Recovery',
    attendance: 'Branch Present',
    reports: 'Reports',
    calculator: 'Calculator',
    profile: 'Profile',
    salary_slips: 'Salary Slips',
    emi_payment: 'EMI Collection',
    center_visits: 'Center Inspection',
    logout: 'Logout',
    enter_mpin: 'Enter 4-digit mPIN',
    login: 'Supervisor Login',
    create_mpin: 'Create Supervisor mPIN',
    forgot_mpin: 'Forgot mPIN?',
    switch_lang: 'हिंदी',
    staffwise: 'Staff-wise',
    branchwise: 'Branch-wise',
    centerwise: 'Center-wise',
  },
  hi: {
    app_title: 'उद्गम सुपरवाइजर ऐप',
    home: 'होम',
    today_due: 'आज का बकाया',
    today_collected: 'आज का कलेक्शन',
    new_member: 'नया सदस्य',
    new_member_report: 'सदस्य रिपोर्ट',
    npa_recovery: 'NPA वसूली',
    attendance: 'शाखा उपस्थिति',
    reports: 'रिपोर्ट्स',
    calculator: 'लोन कैलकुलेटर',
    profile: 'प्रोफाइल',
    salary_slips: 'सैलरी स्लिप',
    emi_payment: 'EMI जमा',
    center_visits: 'सेंटर निरीक्षण',
    logout: 'लॉग आउट',
    enter_mpin: '4-अंकीय mPIN दर्ज करें',
    login: 'सुपरवाइजर लॉगिन',
    create_mpin: 'mPIN बनाएं',
    forgot_mpin: 'mPIN भूल गए?',
    switch_lang: 'English',
    staffwise: 'स्टाफ अनुसार',
    branchwise: 'शाखा अनुसार',
    centerwise: 'सेंटर अनुसार',
  },
};

export function SupervisorAppProvider({ children }) {
  const [supUser, setSupUser] = useState(() => {
    try {
      const saved = localStorage.getItem('udgam_sup_user');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  const [lang, setLang] = useState(() => localStorage.getItem('udgam_sup_lang') || 'hi');
  const [theme, setTheme] = useState(() => localStorage.getItem('udgam_sup_theme') || 'light');
  const [notifications, setNotifications] = useState([
    { id: 1, title: 'Welcome to Udgam Supervisor Portal', time: 'Just now', read: false },
    { id: 2, title: 'Branch collection overview updated', time: 'Today', read: false },
  ]);
  const [notifOpen, setNotifOpen] = useState(false);

  useEffect(() => {
    localStorage.setItem('udgam_sup_lang', lang);
  }, [lang]);

  useEffect(() => {
    localStorage.setItem('udgam_sup_theme', theme);
  }, [theme]);

  const toggleLang = () => setLang((l) => (l === 'hi' ? 'en' : 'hi'));
  const toggleTheme = () => setTheme((t) => (t === 'light' ? 'dark' : 'light'));
  const t = (key) => TRANSLATIONS[lang]?.[key] || TRANSLATIONS.en[key] || key;

  const login = (userData, token) => {
    setSupUser(userData);
    localStorage.setItem('udgam_sup_user', JSON.stringify(userData));
    if (token) localStorage.setItem('udgam_token', token);
  };

  const logout = () => {
    setSupUser(null);
    localStorage.removeItem('udgam_sup_user');
    localStorage.removeItem('udgam_token');
  };

  return (
    <SupervisorAppContext.Provider
      value={{
        supUser,
        login,
        logout,
        lang,
        setLang,
        toggleLang,
        theme,
        toggleTheme,
        t,
        notifications,
        setNotifications,
        notifOpen,
        setNotifOpen,
      }}
    >
      <div className={theme === 'dark' ? 'sup-dark' : ''}>
        {children}
      </div>
    </SupervisorAppContext.Provider>
  );
}

export const useSupApp = () => useContext(SupervisorAppContext);
export const useSupervisorApp = useSupApp;
