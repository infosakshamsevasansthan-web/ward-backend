const express = require('express');
const cors = require('cors');
const { Sequelize, DataTypes } = require('sequelize');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = express();
app.use(cors());

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// 1. Database Connection
const sequelize = new Sequelize(process.env.DATABASE_URL, {
  dialect: 'postgres',
  logging: false,
  dialectOptions: {
    ssl: { require: true, rejectUnauthorized: false }
  }
});

// 2. Models
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

// --- 3. API Routes ---

// लॉगिन
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const user = await User.findOne({ where: { username } });
    if (!user) return res.status(404).json({ message: "उपयोगकर्ता नहीं मिला!" });
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(401).json({ message: "पासवर्ड गलत है!" });

    const token = jwt.sign({ id: user.id, role: user.role }, 'SECRET_KEY_123', { expiresIn: '1d' });
    res.json({ token, role: user.role, username: user.username, assigned_wards: user.assigned_wards });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// यूजर मैनेजमेंट (Admin Only)
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

// डेटा सेव/अपडेट
app.post('/api/save-ward-data', async (req, res) => {
  const { ward_no, section_no, data, status } = req.body;
  try {
    await WardData.upsert({ ward_no, section_no, data, status });
    res.json({ message: "डेटा सुरक्षित हुआ!", status });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// डेटा वापस लाना (Pre-fill)
app.get('/api/get-ward-data/:ward/:section', async (req, res) => {
  try {
    const record = await WardData.findOne({ where: { ward_no: req.params.ward, section_no: req.params.section } });
    res.json(record || { data: null, status: 'pending' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// पूरे वार्ड का स्टेटस
app.get('/api/get-ward-status/:ward', async (req, res) => {
  try {
    const results = await WardData.findAll({ where: { ward_no: req.params.ward }, attributes: ['section_no', 'status'] });
    let statusMap = { 1:'pending', 2:'pending', 3:'pending', 4:'pending', 5:'pending', 6:'pending', 7:'pending', 8:'pending', 9:'pending' };
    results.forEach(item => { statusMap[item.section_no] = item.status; });
    res.json(statusMap);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- 4. Start Server ---
const PORT = process.env.PORT || 5000;
sequelize.sync({ alter: true }).then(async () => {
  const adminCount = await User.count({ where: { role: 'admin' } });
  if (adminCount === 0) {
    const hashedPassword = await bcrypt.hash('admin123', 10);
    await User.create({ username: 'admin', password: hashedPassword, role: 'admin', assigned_wards: [] });
  }
  app.listen(PORT, () => console.log(`🚀 Server on port ${PORT}`));
});