import React, { createContext, useContext, useState, useEffect } from 'react';
import { api } from '../../api/client.js';

const EmployeeAppContext = createContext(null);

const TRANSLATIONS = {
  en: {
    app_title: 'Udgam Employee',
    home: 'Home',
    collections: 'Collections',
    calculator: 'Calculator',
    profile: 'Profile',
    today_due: 'Today Due',
    today_collected: 'Today Collected',
    pending_tasks: 'Pending Tasks',
    quick_actions: 'Quick Actions',
    new_member: 'New Member',
    member_kyc: 'Member KYC',
    guarantor_change: 'Guarantor Change',
    synopsis: 'Borrower Synopsis',
    loan_requisition: 'Loan Requisition',
    collection_history: 'Collection History',
    due_list: 'Due List',
    supervisor_rating: 'Supervisor Rating',
    security_amount: 'Security Amount',
    designation: 'Designation',
    department: 'Department',
    branch: 'Branch',
    logout: 'Logout',
    enter_mpin: 'Enter mPIN',
    login: 'Login',
    create_mpin: 'Create mPIN',
    forgot_mpin: 'Forgot mPIN?',
    performance_graph: 'Staff Performance Graph',
    collect_emi: 'Collect EMI',
    verified_tick: 'Verified',
    unverified: 'Unverified',
    reupload: 'Re-upload',
    reject_reason: 'Rejection Reason',
    search_placeholder: 'Search borrower, loan or group…',
    loanCalculator: 'Loan Calculator',
    collectionHistory: 'Collection History',
    todayDue: 'Today Due Collection',
    newMember: 'New Member Registration',
    memberKyc: 'Member KYC',
    guarantorChange: 'Guarantor Change',
    borrowerSynopsis: 'Borrower Synopsis',
    switch_lang: 'हिंदी',
  },
  hi: {
    app_title: 'उद्गम कर्मचारी ऐप',
    home: 'होम',
    collections: 'कलेक्शन',
    calculator: 'कैलकुलेटर',
    profile: 'प्रोफाइल',
    today_due: 'आज का बकाया',
    today_collected: 'आज का कलेक्शन',
    pending_tasks: 'लंबित कार्य',
    quick_actions: 'मुख्य कार्य',
    new_member: 'नया सदस्य',
    member_kyc: 'सदस्य केवाईसी',
    guarantor_change: 'गारंटर बदलाव',
    synopsis: 'सदस्य विवरण',
    loan_requisition: 'लोन आवेदन',
    collection_history: 'कलेक्शन इतिहास',
    due_list: 'बकाया सूची',
    supervisor_rating: 'सुपरवाइजर रेटिंग',
    security_amount: 'सिक्योरिटी राशि',
    designation: 'पद (Designation)',
    department: 'विभाग',
    branch: 'शाखा',
    logout: 'लॉग आउट',
    enter_mpin: 'mPIN दर्ज करें',
    login: 'लॉग इन करें',
    create_mpin: 'mPIN बनाएं',
    forgot_mpin: 'mPIN भूल गए?',
    performance_graph: 'कर्मचारी प्रदर्शन ग्राफ',
    collect_emi: 'EMI जमा करें',
    verified_tick: 'सत्यापित',
    unverified: 'असत्यापित',
    reupload: 'पुनः अपलोड करें',
    reject_reason: 'अस्वीकृति का कारण',
    search_placeholder: 'उधारकर्ता, लोन या ग्रुप खोजें…',
    loanCalculator: 'लोन कैलकुलेटर',
    collectionHistory: 'कलेक्शन इतिहास',
    todayDue: 'आज का बकाया कलेक्शन',
    newMember: 'नया सदस्य पंजीकरण',
    memberKyc: 'सदस्य केवाईसी',
    guarantorChange: 'गारंटर बदलाव',
    borrowerSynopsis: 'सदस्य विवरण (Borrower Synopsis)',
    switch_lang: 'English',
  },
};

export function EmployeeAppProvider({ children }) {
  const [empUser, setEmpUser] = useState(() => {
    try {
      const saved = localStorage.getItem('udgam_emp_user');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  const [lang, setLang] = useState(() => localStorage.getItem('udgam_emp_lang') || 'hi');
  const [theme, setTheme] = useState(() => localStorage.getItem('udgam_emp_theme') || 'light');
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifOpen, setNotifOpen] = useState(false);

  const fetchNotifications = async () => {
    try {
      const res = await api.employeeApp.notifications();
      setNotifications(res.items || []);
      setUnreadCount(res.unreadCount || 0);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    fetchNotifications();
    const timer = setInterval(fetchNotifications, 60000);
    return () => clearInterval(timer);
  }, []);

  const markNotificationRead = async (id) => {
    try {
      await api.employeeApp.markNotificationRead(id);
      fetchNotifications();
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    localStorage.setItem('udgam_emp_lang', lang);
  }, [lang]);

  useEffect(() => {
    localStorage.setItem('udgam_emp_theme', theme);
  }, [theme]);

  const toggleLang = () => setLang((l) => (l === 'hi' ? 'en' : 'hi'));
  const toggleTheme = () => setTheme((t) => (t === 'light' ? 'dark' : 'light'));
  const t = (key) => TRANSLATIONS[lang]?.[key] || TRANSLATIONS.en[key] || key;

  const login = (userData, token) => {
    setEmpUser(userData);
    localStorage.setItem('udgam_emp_user', JSON.stringify(userData));
    if (token) localStorage.setItem('udgam_token', token);
  };

  const logout = () => {
    setEmpUser(null);
    localStorage.removeItem('udgam_emp_user');
    localStorage.removeItem('udgam_token');
  };

  return (
    <EmployeeAppContext.Provider
      value={{
        empUser,
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
        unreadCount,
        fetchNotifications,
        markNotificationRead,
        notifOpen,
        setNotifOpen,
      }}
    >
      <div className={theme === 'dark' ? 'emp-dark' : ''}>
        {children}
      </div>
    </EmployeeAppContext.Provider>
  );
}

export const useEmpApp = () => useContext(EmployeeAppContext);
export const useEmployeeApp = useEmpApp;
