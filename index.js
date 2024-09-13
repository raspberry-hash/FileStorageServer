const express = require('express');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const multer = require('multer');
const session = require('express-session');
const bcrypt = require('bcrypt');
const fs = require("fs")
// Setup SQLite
const db = new sqlite3.Database('fileStore.db');

const app = express();

// Middleware
app.use(express.static('public'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session setup
app.use(session({
    secret: 'your-secret-key', // Change this to a random secret
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false } // Set `secure: true` if using HTTPS
}));

// Admin credentials (hashed password for simplicity)
const adminUser = { username: 'admin', password: bcrypt.hashSync('adminpassword', 10) };

// Multer setup
const upload = multer({ dest: 'uploads/', limits: { fileSize: 100 * 1024 * 1024 } }); // 100MB limit

// Create file table if not exists
db.run(`
  CREATE TABLE IF NOT EXISTS files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    size INTEGER NOT NULL,
    uploadDate DATETIME DEFAULT CURRENT_TIMESTAMP,
    expirationDate DATETIME,
    ipAddress TEXT
  )
`);

// File upload endpoint
app.post('/upload', upload.single('file'), (req, res) => {
    const { file } = req;
    const expirationDate = req.body.expiration ? new Date(req.body.expiration) : null;
    const ipAddress = req.ip;

    if (!file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }

    db.run(
        'INSERT INTO files (name, size, expirationDate, ipAddress) VALUES (?, ?, ?, ?)',
        [file.originalname, file.size, expirationDate, ipAddress],
        function(err) {
            if (err) {
                return res.status(500).json({ error: 'Failed to save file info' });
            }
            res.json({ fileId: this.lastID });
        }
    );
});

// Serve file info
app.get('/file/:id', (req, res) => {
    const { id } = req.params;

    db.get('SELECT * FROM files WHERE id = ?', [id], (err, file) => {
        if (err) {
            return res.status(500).send('Database error');
        }
        if (!file) {
            return res.status(404).send('File not found');
        }

        // Send file info as HTML with CSS
        res.send(`
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>File Info</title>
                <link rel="stylesheet" href="/styles.css">
            </head>
            <body>
                <div class="container">
                    <h1>File Info</h1>
                    <p><strong>File Name:</strong> ${file.name}</p>
                    <p><strong>File Size:</strong> ${file.size} bytes</p>
                    <p><strong>Uploaded On:</strong> ${new Date(file.uploadDate).toLocaleString()}</p>
                    <p><strong>Expiration Date:</strong> ${file.expirationDate ? new Date(file.expirationDate).toLocaleDateString() : 'No expiration date.'}</p>
                    <p><a href="/uploads/${file.name}" class="download-button" download>Download File</a></p>
                </div>
            </body>
            </html>
        `);
    });
});

// Serve static files from uploads directory
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Serve styles.css from public directory
app.use('/styles.css', express.static(path.join(__dirname, 'public/styles.css')));

// Authentication routes
app.get('/login', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Admin Login</title>
            <link rel="stylesheet" href="/styles.css">
        </head>
        <body>
            <div class="container">
                <h1>Admin Login</h1>
                <form method="POST" action="/login">
                    <label for="username">Username:</label>
                    <input type="text" id="username" name="username" required>
                    <label for="password">Password:</label>
                    <input type="password" id="password" name="password" required>
                    <button type="submit">Login</button>
                </form>
            </div>
        </body>
        </html>
    `);
});

app.post('/login', (req, res) => {
    const { username, password } = req.body;

    if (username === adminUser.username && bcrypt.compareSync(password, adminUser.password)) {
        req.session.admin = true;
        res.redirect('/admin');
    } else {
        res.status(401).send('Unauthorized');
    }
});

// Admin page
app.get('/admin', (req, res) => {
  if (!req.session.admin) {
      return res.redirect('/login');
  }

  db.all('SELECT * FROM files', (err, files) => {
      if (err) {
          return res.status(500).send('Database error');
      }

      // Send admin page HTML with CSS
      res.send(`
          <!DOCTYPE html>
          <html lang="en">
          <head>
              <meta charset="UTF-8">
              <meta name="viewport" content="width=device-width, initial-scale=1.0">
              <title>Admin Dashboard</title>
              <link rel="stylesheet" href="/styles.css">
          </head>
          <body>
              <div class="container">
                  <h1>Admin Dashboard</h1>
                  <a href="/logout" class="button">Logout</a>
                  <h2>Files</h2>
                  <table class="table">
                      <thead>
                          <tr>
                              <th>ID</th>
                              <th>Name</th>
                              <th>Size</th>
                              <th>Uploaded On</th>
                              <th>Actions</th>
                          </tr>
                      </thead>
                      <tbody>
                          ${files.map(file => `
                              <tr class="file-row">
                                  <td>${file.id}</td>
                                  <td>${file.name}</td>
                                  <td>${file.size} bytes</td>
                                  <td>${new Date(file.uploadDate).toLocaleString()}</td>
                                  <td>
                                      <a href="/file/${file.id}" class="button">View</a>
                                      <a href="/download/${file.id}" class="button download-button" download>Download</a>
                                      <a href="/rename/${file.id}" class="button">Rename</a>
                                      <a href="/delete/${file.id}" class="button delete-button">Delete</a>
                                  </td>
                              </tr>
                          `).join('')}
                      </tbody>
                  </table>
              </div>
          </body>
          </html>
      `);
  });
});



// File operations routes
app.get('/download/:id', (req, res) => {
    const { id } = req.params;

    db.get('SELECT * FROM files WHERE id = ?', [id], (err, file) => {
        if (err || !file) {
            return res.status(404).send('File not found');
        }
        res.download(path.join(__dirname, 'uploads', file.name));
    });
});

app.get('/rename/:id', (req, res) => {
    const { id } = req.params;

    if (!req.session.admin) {
        return res.redirect('/login');
    }

    db.get('SELECT * FROM files WHERE id = ?', [id], (err, file) => {
        if (err || !file) {
            return res.status(404).send('File not found');
        }
        res.send(`
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Rename File</title>
                <link rel="stylesheet" href="/styles.css">
            </head>
            <body>
                <div class="container">
                    <h1>Rename File</h1>
                    <form method="POST" action="/rename/${id}">
                        <label for="newName">New File Name:</label>
                        <input type="text" id="newName" name="newName" value="${file.name}" required>
                        <button type="submit">Rename</button>
                    </form>
                </div>
            </body>
            </html>
        `);
    });
});

app.post('/rename/:id', (req, res) => {
    const { id } = req.params;
    const { newName } = req.body;

    if (!req.session.admin) {
        return res.redirect('/login');
    }

    db.get('SELECT * FROM files WHERE id = ?', [id], (err, file) => {
        if (err || !file) {
            return res.status(404).send('File not found');
        }

        const oldPath = path.join(__dirname, 'uploads', file.name);
        const newPath = path.join(__dirname, 'uploads', newName);

        fs.rename(oldPath, newPath, (err) => {
            if (err) {
                return res.status(500).send('Failed to rename file');
            }

            db.run('UPDATE files SET name = ? WHERE id = ?', [newName, id], (err) => {
                if (err) {
                    return res.status(500).send('Failed to update file info');
                }
                res.redirect('/admin');
            });
        });
    });
});

app.get('/delete/:id', (req, res) => {
    const { id } = req.params;

    if (!req.session.admin) {
        return res.redirect('/login');
    }

    db.get('SELECT * FROM files WHERE id = ?', [id], (err, file) => {
        if (err || !file) {
            return res.status(404).send('File not found');
        }

        fs.unlink(path.join(__dirname, 'uploads', file.name), (err) => {
            if (err) {
                return res.status(500).send('Failed to delete file');
            }

            db.run('DELETE FROM files WHERE id = ?', [id], (err) => {
                if (err) {
                    return res.status(500).send('Failed to delete file record');
                }
                res.redirect('/admin');
            });
        });
    });
});

// Logout route
app.get('/logout', (req, res) => {
    req.session.destroy(() => {
        res.redirect('/login');
    });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
