const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'students.json');

app.use(cors());
app.use(bodyParser.json());

// Serve static frontend files from project root
app.use(express.static(path.join(__dirname)));

// Utility: sanitize class name to filename
function sanitizeClassName(name = '') {
  return name.toString().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
}

// Data directory for per-class files
const DATA_DIR = path.join(__dirname, 'data');

// Ensure data directory exists
async function ensureDataDir() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
  } catch (err) {
    // ignore
  }
}

function getClassFile(className) {
  const fileName = sanitizeClassName(className) || 'unknown';
  return path.join(DATA_DIR, `${fileName}.json`);
}

// Read students for a specific class file
async function readClassStudents(className) {
  try {
    const file = getClassFile(className);
    const data = await fs.readFile(file, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

// Write students for a specific class file
async function writeClassStudents(className, students) {
  const file = getClassFile(className);
  await fs.writeFile(file, JSON.stringify(students, null, 2), 'utf8');
}

// Read all students across class files
async function readAllStudents() {
  try {
    await ensureDataDir();
    const files = await fs.readdir(DATA_DIR);
    const all = [];
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      const content = await fs.readFile(path.join(DATA_DIR, f), 'utf8');
      const arr = JSON.parse(content || '[]');
      all.push(...arr);
    }
    return all;
  } catch (err) {
    return [];
  }
}

// Migrate legacy students.json into per-class files (if present)
async function migrateLegacy() {
  try {
    await ensureDataDir();
    const legacyPath = DATA_FILE;
    const exists = await fs.stat(legacyPath).then(() => true).catch(() => false);
    if (!exists) return;

    const raw = await fs.readFile(legacyPath, 'utf8');
    const students = JSON.parse(raw || '[]');
    for (const s of students) {
      const className = s.class || 'unknown';
      const list = await readClassStudents(className);
      // avoid duplicates by id
      if (!list.find(x => x.id === s.id)) list.push(s);
      await writeClassStudents(className, list);
    }
    // optionally remove legacy file
    // await fs.unlink(legacyPath);
  } catch (err) {
    console.error('Migration error:', err);
  }
}

// API: get students (optionally by class)
app.get('/api/students', async (req, res) => {
  try {
    const className = req.query.class;
    if (className) {
      const students = await readClassStudents(className);
      return res.json(students);
    }
    const students = await readAllStudents();
    res.json(students);
  } catch (err) {
    res.status(500).json({ error: 'Failed to read students' });
  }
});

// API: get list of classes
app.get('/api/classes', async (req, res) => {
  try {
    const all = await readAllStudents();
    const classes = Array.from(new Set(all.map(s => s.class))).filter(Boolean);
    res.json(classes);
  } catch (err) {
    res.status(500).json({ error: 'Failed to read classes' });
  }
});

// API: add a student to a class
app.post('/api/students', async (req, res) => {
  try {
    const { name, class: studentClass, grade } = req.body;
    if (!name || !studentClass || !grade) {
      return res.status(400).json({ error: 'name, class and grade are required' });
    }

    const newStudent = { id: uuidv4(), name, class: studentClass, grade };
    const list = await readClassStudents(studentClass);
    list.push(newStudent);
    await writeClassStudents(studentClass, list);
    res.status(201).json(newStudent);
  } catch (err) {
    res.status(500).json({ error: 'Failed to add student' });
  }
});

// API: delete a student by id (search across classes)
app.delete('/api/students/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const files = await fs.readdir(DATA_DIR);
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      const filePath = path.join(DATA_DIR, f);
      const content = await fs.readFile(filePath, 'utf8');
      const arr = JSON.parse(content || '[]');
      const before = arr.length;
      const filtered = arr.filter(s => s.id !== id);
      if (filtered.length !== before) {
        await fs.writeFile(filePath, JSON.stringify(filtered, null, 2), 'utf8');
        return res.json({ success: true });
      }
    }
    res.status(404).json({ error: 'Student not found' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete student' });
  }
});

// API: update a student by id (search across classes; if class changed, move record)
app.put('/api/students/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const { name, class: newClass, grade } = req.body;
    if (!name || !newClass || !grade) {
      return res.status(400).json({ error: 'name, class and grade are required' });
    }

    const files = await fs.readdir(DATA_DIR);
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      const filePath = path.join(DATA_DIR, f);
      const content = await fs.readFile(filePath, 'utf8');
      const arr = JSON.parse(content || '[]');
      const idx = arr.findIndex(s => s.id === id);
      if (idx !== -1) {
        const student = arr[idx];
        // if class changed, remove from current and add to new class file
        if ((student.class || '') !== newClass) {
          arr.splice(idx, 1);
          await fs.writeFile(filePath, JSON.stringify(arr, null, 2), 'utf8');
          const newList = await readClassStudents(newClass);
          const updated = { ...student, name, class: newClass, grade };
          newList.push(updated);
          await writeClassStudents(newClass, newList);
          return res.json(updated);
        }

        // otherwise update in place
        student.name = name;
        student.class = newClass;
        student.grade = grade;
        await fs.writeFile(filePath, JSON.stringify(arr, null, 2), 'utf8');
        return res.json(student);
      }
    }

    res.status(404).json({ error: 'Student not found' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update student' });
  }
});

// Fallback: serve index.html for unknown routes (optional)
app.get('*', (req, res) => {
  const indexPath = path.join(__dirname, 'basic.html');
  res.sendFile(indexPath);
});

// Ensure migration then start server
migrateLegacy().then(() => {
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}).catch(err => {
  console.error('Failed migration:', err);
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
});
