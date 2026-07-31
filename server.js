const express = require('express');
const cors = require('cors');
const { Sequelize, DataTypes } = require('sequelize');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = express();

// 1. Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// 2. Database Connection
const sequelize = new Sequelize(process.env.DATABASE_URL, {
  dialect: 'postgres',
  logging: false,
  dialectOptions: {
    ssl: { require: true, rejectUnauthorized: false }
  }
});

// 3. Models
const User = sequelize.define('User', {
  username: { type: DataTypes.STRING, unique: true, allowNull: false },
  password: { type: DataTypes.STRING, allowNull: false },
  role: { type: DataTypes.STRING, defaultValue: 'user' },
  assigned_wards: { type: DataTypes.JSONB, defaultValue: [] }
});

const WardData = sequelize.define('WardData', {
  ward_no: { type: DataTypes.STRING, allowNull: false },
  section_no: { type: DataTypes.INTEGER, allowNull: false },
  data: { type: DataTypes.JSONB }, 
  status: { type: DataTypes.STRING },
}, {
  indexes: [{ unique: true, fields: ['ward_no', 'section_no'] }]
});

// --- 4. API Routes ---

// लॉगिन API
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const user = await User.findOne({ where: { username } });
    if (!user) return res.status(404).json({ message: "उपयोगकर्ता नहीं मिला!" });
    
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(401).json({ message: "पासवर्ड गलत है!" });

    const token = jwt.sign({ id: user.id, role: user.role }, 'SECRET_KEY_123', { expiresIn: '1d' });
    res.json({ 
      token, 
      role: user.role, 
      username: user.username, 
      assigned_wards: user.assigned_wards 
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// यूजर मैनेजमेंट (सिर्फ Admin के लिए)
app.get('/api/users', async (req, res) => {
  try {
    const users = await User.findAll({ where: { role: 'user' }, attributes: { exclude: ['password'] } });
    res.json(users);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/users', async (req, res) => {
  try {
    const { username, password, assigned_wards } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = await User.create({ username, password: hashedPassword, assigned_wards, role: 'user' });
    res.json(newUser);
  } catch (err) { res.status(500).json({ error: "यूजरनाम पहले से मौजूद है!" }); }
});

// डेटा सेव/अपडेट (Individual Sections)
// डेटा सेव/अपडेट करने का एकदम पक्का तरीका
app.post('/api/save-ward-data', async (req, res) => {
  const { ward_no, section_no, data, status } = req.body;
  
  try {
    // 1. पहले चेक करो कि क्या इस वार्ड और सेक्शन का डेटा पहले से है?
    const existingRecord = await WardData.findOne({ 
      where: { ward_no, section_no } 
    });

    if (existingRecord) {
      // 2. अगर है, तो उसे अपडेट (Update) कर दो
      await existingRecord.update({ data, status });
      return res.json({ message: "डेटा अपडेट हो गया!", status });
    } else {
      // 3. अगर नहीं है, तो नया बना (Create) दो
      await WardData.create({ ward_no, section_no, data, status });
      return res.json({ message: "डेटा सुरक्षित हो गया!", status });
    }
  } catch (err) {
    console.error("SAVE ERROR:", err); // यह टर्मिनल में असली एरर दिखाएगा
    res.status(500).json({ error: "डेटाबेस एरर: " + err.message });
  }
});

// डेटा वापस लोड करना (Pre-fill Form)
app.get('/api/get-ward-data/:ward/:section', async (req, res) => {
  try {
    const record = await WardData.findOne({ where: { ward_no: req.params.ward, section_no: req.params.section } });
    res.json(record || { data: null, status: 'pending' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// पूरे वार्ड के अनुभागों का स्टेटस
app.get('/api/get-ward-status/:ward', async (req, res) => {
  try {
    const results = await WardData.findAll({ where: { ward_no: req.params.ward }, attributes: ['section_no', 'status'] });
    let statusMap = { 1:'pending', 2:'pending', 3:'pending', 4:'pending', 5:'pending', 6:'pending', 7:'pending', 8:'pending', 9:'pending' };
    results.forEach(item => { statusMap[item.section_no] = item.status; });
    res.json(statusMap);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// डैशबोर्ड लाइव स्टैट्स
app.get('/api/admin/dashboard-stats', async (req, res) => {
  try {
    const totalUsers = await User.count({ where: { role: 'user' } });
    const completeWardsData = await WardData.findAll({
      where: { status: 'complete' },
      attributes: ['ward_no'],
      group: ['ward_no'],
      having: sequelize.where(sequelize.fn('COUNT', sequelize.col('section_no')), '=', 9)
    });
    const completeCount = completeWardsData.length;
    res.json({ totalWards: 49, totalUsers, completeCount, pendingCount: 49 - completeCount });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// सभी वार्डों की समरी (Dashboard Table)
app.get('/api/admin/all-wards-summary', async (req, res) => {
  try {
    const allData = await WardData.findAll();
    const summary = {};
    allData.forEach(item => {
      if (!summary[item.ward_no]) summary[item.ward_no] = {};
      summary[item.ward_no][item.section_no] = { status: item.status, data: item.data };
    });
    res.json(summary);
  } catch (err) { res.status(500).json({ error: err.message }); }
});
app.get('/api/ward-full-report/:ward', async (req, res) => {
  try {
    const data = await WardData.findAll({
      where: { ward_no: req.params.ward },
      order: [['section_no', 'ASC']]
    });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.post('/api/change-password', async (req, res) => {
  const { username, oldPassword, newPassword } = req.body;
  try {
    const user = await User.findOne({ where: { username } });
    const isMatch = await bcrypt.compare(oldPassword, user.password);
    if (!isMatch) return res.status(401).json({ message: "पुराना पासवर्ड गलत है!" });

    const hashedNew = await bcrypt.hash(newPassword, 10);
    user.password = hashedNew;
    await user.save();
    res.json({ message: "Success" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
// --- 5. Start Server ---
const PORT = process.env.PORT || 5000;
sequelize.sync({ alter: true }).then(async () => {
  const adminCount = await User.count({ where: { role: 'admin' } });
  if (adminCount === 0) {
    const hashedPassword = await bcrypt.hash('admin123', 10);
    await User.create({ username: 'admin', password: hashedPassword, role: 'admin', assigned_wards: [] });
    console.log("--> Default Admin: admin / admin123");
  }
  app.listen(PORT, () => console.log(`🚀 API Server running on port ${PORT}`));
}).catch(err => console.error("❌ DB Error:", err));