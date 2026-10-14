require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const csv = require('csv-parser');

const app = express();

// --- 1. DIRECTORY SETUP & MULTER STORAGE (VERCEL COMPATIBLE) ---
// On Vercel, root filesystem is read-only; /tmp is the only writable directory
const isVercel = !!process.env.VERCEL;
const uploadDir = isVercel ? path.join('/tmp', 'uploads') : path.join(__dirname, 'uploads');

try {
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }
} catch (err) {
  console.warn('Upload directory initialization warning:', err.message);
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const sanitizedBase = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9_-]/g, '_');
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e6);
    cb(null, `${sanitizedBase}-${uniqueSuffix}${ext}`);
  }
});
const upload = multer({ storage });

// --- 2. MIDDLEWARE ---
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(uploadDir));
app.use(express.static(__dirname));

// --- 3. DATABASE CONNECTION (SERVERLESS CACHED POOL) ---
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/nexus_db';

let isConnecting = null;
const connectDB = async () => {
  if (mongoose.connection.readyState >= 1) return;
  if (!isConnecting) {
    isConnecting = mongoose.connect(MONGODB_URI, {
      serverSelectionTimeoutMS: 5000
    }).then(conn => {
      console.log('✅ Nexus Connected to Database:', MONGODB_URI.split('@').pop().split('?')[0]);
      isConnecting = null;
      return conn;
    }).catch(err => {
      isConnecting = null;
      console.error('❌ MongoDB Connection Error:', err.message);
      throw err;
    });
  }
  return isConnecting;
};

// Only require database for API routes (never block static HTML files)
const isApiRoute = (p) => {
  return p.startsWith('/api') || p === '/login' || p === '/register' || p === '/students' || p.startsWith('/attendance') || p === '/import-students';
};

app.use(async (req, res, next) => {
  if (!isApiRoute(req.path)) return next();
  try {
    await connectDB();
    next();
  } catch (err) {
    const isMissingEnv = !process.env.MONGODB_URI;
    res.status(503).json({ 
      error: 'Database connection failed.',
      reason: isMissingEnv 
        ? 'MONGODB_URI environment variable is not set in Vercel.' 
        : err.message,
      checklist: [
        '1. Added MONGODB_URI in Vercel -> Settings -> Environment Variables?',
        '2. Added 0.0.0.0/0 (Allow from anywhere) in MongoDB Atlas -> Network Access?',
        '3. Did you click Redeploy in Vercel Deployments tab after saving the variable?'
      ]
    });
  }
});

// --- 4. SCHEMAS & MODELS ---
const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  uniqueId: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, enum: ['student', 'teacher'], required: true },
  degree: { type: String, enum: ['BCA', 'BBA', 'BCOM'] },
  semester: { type: String, enum: ['1', '2', '3', '4', '5', '6'] },
  section: { type: String, enum: ['A', 'B', 'C', 'D'] }
}, { timestamps: true });

userSchema.pre('save', async function() {
  if (!this.isModified('password')) return;
  this.password = await bcrypt.hash(this.password, 10);
});

const User = mongoose.models.User || mongoose.model('User', userSchema);

const subjectSchema = new mongoose.Schema({
  name: { type: String, required: true },
  degree: { type: String, enum: ['BCA', 'BBA', 'BCOM'], required: true },
  semester: { type: String, enum: ['1', '2', '3', '4', '5', '6'], required: true }
});
subjectSchema.index({ name: 1, degree: 1, semester: 1 }, { unique: true });
const Subject = mongoose.models.Subject || mongoose.model('Subject', subjectSchema);

const attendanceSchema = new mongoose.Schema({
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  subjectName: { type: String, required: true },
  status: { type: String, enum: ['present', 'absent'], required: true },
  date: { type: String, required: true }
});
attendanceSchema.index({ studentId: 1, subjectName: 1, date: 1 }, { unique: true });
const Attendance = mongoose.models.Attendance || mongoose.model('Attendance', attendanceSchema);

const marksSchema = new mongoose.Schema({
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  subjectName: { type: String, required: true },
  assessmentType: { type: String, enum: ['Class Test 1', 'Class Test 2', 'Exam'], required: true },
  assessmentTitle: { type: String, required: true },
  marksObtained: { type: Number, required: true }
});
marksSchema.index({ studentId: 1, subjectName: 1, assessmentType: 1 }, { unique: true });
const Marks = mongoose.models.Marks || mongoose.model('Marks', marksSchema);

const eduTrackSchema = new mongoose.Schema({
  type: { type: String, enum: ['Assignment', 'Exam', 'Class Test', 'Holiday'], required: true },
  title: { type: String, required: true },
  subject: String,
  postDate: { type: String, default: () => new Date().toISOString().split('T')[0] },
  submissionDate: String,
  degree: { type: String, enum: ['BCA', 'BBA', 'BCOM'] },
  semester: { type: String, enum: ['1', '2', '3', '4', '5', '6'] },
  fileName: String,
  filePath: String
});
const EduTrack = mongoose.models.EduTrack || mongoose.model('EduTrack', eduTrackSchema);

// Helper: Sanitize User Document
const sanitizeUser = (user) => ({
  _id: user._id,
  name: user.name,
  uniqueId: user.uniqueId,
  role: user.role,
  degree: user.degree,
  semester: user.semester,
  section: user.section
});

// --- 5. ROUTES ---

// Health check endpoint
app.get('/health', (req, res) => res.json({ status: 'ok', uptime: process.uptime(), vercel: isVercel }));

// Register
app.post('/register', async (req, res) => {
  try {
    const { name, uniqueId, password, role, degree, semester, section } = req.body;
    if (!name || !uniqueId || !password) {
      return res.status(400).json({ error: 'Name, Unique ID, and Password are required.' });
    }

    const existing = await User.findOne({ uniqueId: uniqueId.trim() });
    if (existing) {
      return res.status(400).json({ error: 'User with this Unique ID already exists.' });
    }

    const newUser = new User({
      name: name.trim(),
      uniqueId: uniqueId.trim(),
      password,
      role: role || 'teacher',
      degree,
      semester,
      section
    });
    await newUser.save();
    res.json({ message: 'Teacher Registered Successfully' });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Registration Failed' });
  }
});

// Login
app.post('/login', async (req, res) => {
  try {
    const { uniqueId, password } = req.body;
    if (!uniqueId || !password) {
      return res.status(400).json({ error: 'Unique ID and password are required.' });
    }

    const user = await User.findOne({ uniqueId: uniqueId.trim() });
    if (user && await bcrypt.compare(password, user.password)) {
      res.json(sanitizeUser(user));
    } else {
      res.status(401).json({ error: 'Invalid Credentials' });
    }
  } catch (err) {
    res.status(500).json({ error: 'Authentication Error' });
  }
});

// Mass Student Import (Fixed bcrypt hashing & /tmp file safety)
app.post('/import-students', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No CSV file attached.' });
  }

  const filePath = req.file.path;
  const cleanUpFile = () => {
    try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (e) { /* ignore */ }
  };

  try {
    const uniqueid = req.headers.uniqueid || req.body.uniqueId;
    const password = req.headers.password || req.body.password;

    const teacher = await User.findOne({ uniqueId: uniqueid, role: 'teacher' });
    if (!teacher || !(await bcrypt.compare(password, teacher.password))) {
      cleanUpFile();
      return res.status(401).json({ error: 'Unauthorized: Invalid Faculty Credentials' });
    }

    const defaultHashedPassword = await bcrypt.hash('password123', 10);
    const results = [];

    fs.createReadStream(filePath)
      .pipe(csv(['name', 'uniqueId', 'degree', 'semester', 'section']))
      .on('data', (data) => {
        if (data.uniqueId && data.uniqueId.toLowerCase() !== 'uniqueid' && data.name && data.name.toLowerCase() !== 'name') {
          results.push({
            name: data.name.trim(),
            uniqueId: data.uniqueId.trim(),
            degree: data.degree ? data.degree.trim() : 'BCA',
            semester: data.semester ? data.semester.trim() : '1',
            section: data.section ? data.section.trim() : 'A',
            role: 'student',
            password: defaultHashedPassword
          });
        }
      })
      .on('error', (streamErr) => {
        cleanUpFile();
        res.status(400).json({ error: 'Error parsing CSV file: ' + streamErr.message });
      })
      .on('end', async () => {
        cleanUpFile();
        if (results.length === 0) {
          return res.status(400).json({ error: 'No valid student records found in CSV.' });
        }
        try {
          const insertResult = await User.insertMany(results, { ordered: false });
          res.json({ message: `Successfully enrolled ${insertResult.length} students.` });
        } catch (err) {
          const insertedCount = err.insertedDocs ? err.insertedDocs.length : 0;
          res.json({
            message: `Import processed. Enrolled ${insertedCount} students. (Some duplicates may have been skipped).`
          });
        }
      });
  } catch (err) {
    cleanUpFile();
    res.status(500).json({ error: 'Import Failed: ' + err.message });
  }
});

// Curriculum / Subjects API
app.get('/api/subjects', async (req, res) => {
  try {
    const filter = {};
    if (req.query.degree) filter.degree = req.query.degree;
    if (req.query.semester) filter.semester = req.query.semester;
    const subjects = await Subject.find(filter).sort({ name: 1 });
    res.json(subjects);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch subjects.' });
  }
});

app.post('/api/subjects', async (req, res) => {
  try {
    const { name, degree, semester } = req.body;
    if (!name || !degree || !semester) {
      return res.status(400).json({ error: 'All fields are required.' });
    }
    const newSubject = new Subject({ name: name.trim(), degree, semester });
    await newSubject.save();
    res.json({ success: true, message: 'Module registered.' });
  } catch (err) {
    res.status(400).json({ error: err.code === 11000 ? 'Module already exists for this semester.' : err.message });
  }
});

app.delete('/api/subjects/:id', async (req, res) => {
  try {
    await Subject.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete module.' });
  }
});

// Students List (Safe filtered query)
app.get('/students', async (req, res) => {
  try {
    const filter = { role: 'student' };
    if (req.query.degree) filter.degree = req.query.degree;
    if (req.query.semester) filter.semester = req.query.semester;
    if (req.query.section) filter.section = req.query.section;

    const students = await User.find(filter).select('-password').sort({ uniqueId: 1 });
    res.json(students);
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve students.' });
  }
});

// Attendance API
app.post('/api/attendance', async (req, res) => {
  try {
    const { studentId, subjectName, status, date } = req.body;
    if (!studentId || !subjectName || !status || !date) {
      return res.status(400).json({ error: 'Missing required attendance fields.' });
    }
    await Attendance.findOneAndUpdate(
      { studentId, subjectName, date },
      { status },
      { upsert: true, new: true }
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to record attendance.' });
  }
});

// Bulk Attendance API
app.post('/api/attendance/bulk', async (req, res) => {
  try {
    const { records } = req.body;
    if (!Array.isArray(records) || records.length === 0) {
      return res.status(400).json({ error: 'No attendance records provided.' });
    }

    const bulkOps = records.map(r => ({
      updateOne: {
        filter: { studentId: r.studentId, subjectName: r.subjectName, date: r.date },
        update: { $set: { status: r.status } },
        upsert: true
      }
    }));

    await Attendance.bulkWrite(bulkOps);
    res.json({ success: true, count: records.length });
  } catch (err) {
    res.status(500).json({ error: 'Bulk attendance operation failed.' });
  }
});

// Attendance Roster with Pre-loaded Status
app.get('/api/attendance/roster', async (req, res) => {
  try {
    const { degree, semester, section, subjectName, date } = req.query;
    const filter = { role: 'student' };
    if (degree) filter.degree = degree;
    if (semester) filter.semester = semester;
    if (section) filter.section = section;

    const students = await User.find(filter).select('_id name uniqueId').sort({ uniqueId: 1 });
    const studentIds = students.map(s => s._id);

    const existing = await Attendance.find({
      studentId: { $in: studentIds },
      subjectName,
      date
    });

    const statusMap = {};
    existing.forEach(a => { statusMap[a.studentId.toString()] = a.status; });

    const roster = students.map(s => ({
      _id: s._id,
      name: s.name,
      uniqueId: s.uniqueId,
      status: statusMap[s._id.toString()] || null
    }));

    res.json(roster);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load roster.' });
  }
});

app.delete('/api/attendance', async (req, res) => {
  try {
    const { studentId, subjectName, date } = req.body;
    await Attendance.findOneAndDelete({ studentId, subjectName, date });
    res.json({ success: true, message: 'Attendance record purged.' });
  } catch (err) {
    res.status(500).json({ error: 'Purge failed.' });
  }
});

// Marks API
app.post('/api/marks', async (req, res) => {
  try {
    const { studentId, subjectName, assessmentType, assessmentTitle, marksObtained } = req.body;
    const numericMarks = Number(marksObtained);
    if (isNaN(numericMarks) || marksObtained === '' || marksObtained === null) {
      return res.status(400).json({ error: 'Marks obtained must be a valid number.' });
    }

    await Marks.findOneAndUpdate(
      { studentId, subjectName, assessmentType },
      { assessmentTitle: assessmentTitle || assessmentType, marksObtained: numericMarks },
      { upsert: true, new: true }
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to record marks.' });
  }
});

// Bulk Marks API
app.post('/api/marks/bulk', async (req, res) => {
  try {
    const { records } = req.body;
    if (!Array.isArray(records) || records.length === 0) {
      return res.status(400).json({ error: 'No marks data provided.' });
    }

    const validRecords = records.filter(r => r.marksObtained !== '' && !isNaN(Number(r.marksObtained)));
    const bulkOps = validRecords.map(r => ({
      updateOne: {
        filter: { studentId: r.studentId, subjectName: r.subjectName, assessmentType: r.assessmentType },
        update: { $set: { assessmentTitle: r.assessmentTitle, marksObtained: Number(r.marksObtained) } },
        upsert: true
      }
    }));

    if (bulkOps.length > 0) {
      await Marks.bulkWrite(bulkOps);
    }
    res.json({ success: true, count: bulkOps.length });
  } catch (err) {
    res.status(500).json({ error: 'Bulk marks update failed.' });
  }
});

// EduTrack Feed API
app.post('/api/edutrack', upload.single('file'), async (req, res) => {
  try {
    const { type, title, subject, degree, semester, submissionDate } = req.body;
    if (!type || !title) {
      return res.status(400).json({ error: 'Type and Title are required.' });
    }

    const relativeFilePath = req.file ? `/uploads/${req.file.filename}` : null;

    const post = new EduTrack({
      type,
      title: title.trim(),
      subject: subject || '',
      degree: degree || null,
      semester: semester || null,
      submissionDate: submissionDate || null,
      fileName: req.file ? req.file.originalname : null,
      filePath: relativeFilePath
    });

    await post.save();
    res.json({ success: true, message: 'Broadcast published.' });
  } catch (err) {
    res.status(500).json({ error: 'Broadcast failed: ' + err.message });
  }
});

app.get('/api/edutrack', async (req, res) => {
  try {
    const posts = await EduTrack.find().sort({ _id: -1 });
    res.json(posts);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch broadcasts.' });
  }
});

// Student Individual Reports API
app.get('/attendance/:uId', async (req, res) => {
  try {
    const student = await User.findOne({ uniqueId: req.params.uId.trim(), role: 'student' });
    if (!student) return res.status(404).json({ error: 'Student unique ID not found.' });

    const records = await Attendance.find({ studentId: student._id }).sort({ date: 1 });
    res.json({
      name: student.name,
      uniqueId: student.uniqueId,
      degree: student.degree,
      semester: student.semester,
      section: student.section,
      records
    });
  } catch (err) {
    res.status(500).json({ error: 'Server error retrieving attendance.' });
  }
});

app.get('/api/student-marks/:uId', async (req, res) => {
  try {
    const student = await User.findOne({ uniqueId: req.params.uId.trim(), role: 'student' });
    if (!student) return res.status(404).json({ error: 'Student unique ID not found.' });

    const marks = await Marks.find({ studentId: student._id });
    res.json(marks);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch marks.' });
  }
});

// --- HTML PAGE ROUTES FOR VERCEL & LOCAL ---
const findHtmlFile = (fileName) => {
  const possible = [
    path.join(__dirname, 'public', fileName),
    path.join(__dirname, fileName),
    path.join(process.cwd(), 'public', fileName),
    path.join(process.cwd(), fileName)
  ];
  for (const p of possible) {
    if (fs.existsSync(p)) return p;
  }
  return null;
};

app.get('/', (req, res) => {
  const f = findHtmlFile('index.html');
  if (f) return res.sendFile(f);
  res.status(404).send('index.html not found');
});

const pages = ['index', 'teachers', 'student', 'edutrack', 'register', 'import', 'about', 'services', 'contact'];
pages.forEach(page => {
  app.get([`/${page}.html`, `/${page}`], (req, res) => {
    const f = findHtmlFile(`${page}.html`);
    if (f) return res.sendFile(f);
    res.status(404).send(`${page}.html not found`);
  });
});

// --- 6. SERVER INITIALIZATION & EXPORT ---
// When deployed on Vercel, app is executed as a serverless function, so we export app
if (!isVercel) {
  const PORT = process.env.PORT || 5000;
  app.listen(PORT, () => {
    console.log(`🚀 Nexus Academic Platform active on port ${PORT}`);
  });
}

module.exports = app;
