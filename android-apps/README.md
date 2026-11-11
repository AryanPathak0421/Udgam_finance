# Udgam Microfinance - Android APKs (Staff, Supervisor & Member)

This directory contains standalone Android native wrapper configurations for:

1. **Udgam Staff App**:
   - Package: `com.udgam.staff`
   - Start URL: `https://udgam-finance.vercel.app/employee/login`
   - Scope: `/employee/`
   - Location: `android-apps/UdgamStaff/`

2. **Udgam Supervisor App**:
   - Package: `com.udgam.supervisor`
   - Start URL: `https://udgam-finance.vercel.app/supervisor/login`
   - Scope: `/supervisor/`
   - Location: `android-apps/UdgamSupervisor/`

3. **Udgam Member App (Customer)**:
   - Package: `com.udgam.member`
   - Start URL: `https://udgam-finance.vercel.app/member/login`
   - Scope: `/member/`
   - Location: `android-apps/UdgamMember/`

## How all 3 apps work independently:
- **Scope & ID Separation**:
  - Staff App scope: `/employee/`
  - Supervisor App scope: `/supervisor/`
  - Member App scope: `/member/`
  - Because scopes and package IDs are completely isolated, you can install **ALL THREE APPS** simultaneously on the same Android device with separate icons, isolated cookies/sessions, and independent home screen launchers.

## 2 Ways to Get Separate Apps / APKs:

### Method 1: Instant Chrome WebAPK Installation (Direct on Phone)
1. Open Chrome on Android and visit `/employee/login` -> Tap **Install** -> Installs **Udgam Staff App**.
2. Open Chrome on Android and visit `/supervisor/login` -> Tap **Install** -> Installs **Udgam Supervisor App**.
3. Open Chrome on Android and visit `/member/login` -> Tap **Install** -> Installs **Udgam Member App**.
4. Chrome builds three independent Android WebAPKs on your phone home screen with distinct icons.

### Method 2: Android Studio / Gradle APK Build
1. Open `android-apps/UdgamStaff` -> Build `Udgam_Staff.apk`
2. Open `android-apps/UdgamSupervisor` -> Build `Udgam_Supervisor.apk`
3. Open `android-apps/UdgamMember` -> Build `Udgam_Member.apk`

