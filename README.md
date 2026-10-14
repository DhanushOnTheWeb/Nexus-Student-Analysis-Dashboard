# ⚡ Nexus Student Analytics & Faculty Command Platform

A unified academic intelligence dashboard and institution management system built with **Node.js, Express, MongoDB (Mongoose), Chart.js**, and modern web standards.

---

## 🌟 Key Features

- **🎓 Student Intelligence Gateway (`student.html`)**:
  - Live subject-wise attendance tracking with dynamic progress bars.
  - Automated **75% Mandatory Attendance Threshold Alert** (Eligible vs Shortage warning).
  - Clean modular assessment scoring (Class Test 1, Class Test 2, Exam).
  - Responsive **Chart.js** bar distribution.

- **👔 Faculty Command Portal (`teachers.html`)**:
  - **1-Click Bulk Attendance**: "Mark All Present", "Mark All Absent", and batch persistence.
  - **Pre-Loaded Attendance State**: Automatically loads previous marks/attendance for any selected date and module.
  - **Curriculum Management**: Add and delete course modules per degree and semester.
  - **Embedded Mass CSV Enrollment**: Direct drag-and-drop CSV importer with downloadable template.
  - **Session Persistence**: Stays logged in across page reloads with a dedicated Sign Out button.
  - **Toast Notifications**: Modern floating alert banners instead of disruptive popups.

- **📢 EduTrack Feed (`edutrack.html`)**:
  - Departmental notices, examination timetables, and assignments.
  - Assignment due date badges with file attachments (PDFs, DOCX, images) preserving original file extensions.

---

## 🚀 Running Locally

### 1. Install Dependencies
```bash
npm install
```

### 2. Environment Configuration
Copy `.env.example` to `.env`:
```env
PORT=5000
MONGODB_URI=mongodb://localhost:27017/nexus_db
```

### 3. Launch Development Server
```bash
npm start
```
The server will start on [http://localhost:5000](http://localhost:5000).

---


   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: `Free`
4. Under **Environment Variables**, add:
   - `MONGODB_URI`: *Your MongoDB Atlas connection string*
5. Click **Deploy Web Service**. Render will provision your app and assign an HTTPS URL!
