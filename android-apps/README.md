# Udgam Microfinance - Android APKs (Staff & Supervisor)

This directory contains standalone Android native wrapper configurations for:

1. **Udgam Staff App**:
   - Package: `com.udgam.staff`
   - Start URL: `https://udgam-finance.vercel.app/employee/login`
   - Location: `android-apps/UdgamStaff/`

2. **Udgam Supervisor App**:
   - Package: `com.udgam.supervisor`
   - Start URL: `https://udgam-finance.vercel.app/supervisor/login`
   - Location: `android-apps/UdgamSupervisor/`

## How both apps work independently:
- **Scope & ID Separation**:
  - Staff App scope: `/employee/`
  - Supervisor App scope: `/supervisor/`
  - Because scopes and package IDs are completely isolated, you can install **BOTH APKS / APPS** simultaneously on the same Android device with separate icons, notifications, and isolated sessions.

## 2 Ways to Get Separate APKs:

### Method 1: Instant Chrome WebAPK Installation (Direct on Phone)
1. Open Chrome on Android and visit `https://udgam-finance.vercel.app/employee/login` -> Tap **Install** -> Installs **Udgam Staff App**.
2. Open Chrome on Android and visit `https://udgam-finance.vercel.app/supervisor/login` -> Tap **Install** -> Installs **Udgam Supervisor App**.
3. Chrome builds two independent Android WebAPKs on your phone home screen with distinct icons.

### Method 2: Android Studio / Gradle APK Build
1. Open `android-apps/UdgamStaff` in Android Studio -> Click **Build > Build Bundle(s) / APK(s) > Build APK(s)** to generate `Udgam_Staff.apk`.
2. Open `android-apps/UdgamSupervisor` in Android Studio -> Click **Build > Build Bundle(s) / APK(s) > Build APK(s)** to generate `Udgam_Supervisor.apk`.
