/**
 * CS380 Inventory Management System - Backend Server
 *
 * DB schema:
 *   Users(UserID, Username, PasswordHash)
 *   Products(ProductID, Stock)
 *
 * Product titles and details are fetched from:
 *   https://api.escuelajs.co/api/v1/products
 *
 * Relevant endpoints used:
 *   GET /api/v1/products?title=<query>   — search by title
 *   GET /api/v1/products/<id>            — fetch single product
 */

const express = require('express');
const session = require('express-session');
const mysql   = require('mysql2/promise');
const path    = require('path');

const app  = express();
const PORT = 3000;

const EXTERNAL_API_BASE = 'https://api.escuelajs.co/api/v1';

// ── Database connection ────────────────────────────────────────────────────
const dbConfig = {
    host:     'localhost',
    user:     'root',
    password: '',
};

// Drops and recreates the inventory_db schema, seeds two default users, and
// returns an open connection ready for queries.
async function initDB() {
    const conn = await mysql.createConnection(dbConfig);

    await conn.query('DROP DATABASE IF EXISTS inventory_db');
    await conn.query('CREATE DATABASE IF NOT EXISTS inventory_db');
    await conn.query('USE inventory_db');

    await conn.query(`
        CREATE TABLE Users(
            UserID int primary key NOT NULL AUTO_INCREMENT,
            Username varchar(40) NOT NULL,
            PasswordHash varchar(64) NOT NULL
        )
    `);

    await conn.query(`
        CREATE TABLE Products(
            ProductID int primary key NOT NULL,
            Stock int NOT NULL
        )
    `);

    await conn.query(`
        INSERT INTO Users(Username, PasswordHash)
        VALUES
            ('Tester001', SHA2('P@ssw0rd123', 256)),
            ('1',         SHA2('1', 256))
    `);

    console.log('Database initialised.');
    return conn;
}

let db;
(async () => {
    try {
        db = await initDB();
        console.log('Connected to MySQL database.');
    } catch (err) {
        console.error('MySQL not available – server cannot start.');
        console.error(err.message);
        process.exit(1);
    }
})();

// ── External API helpers ───────────────────────────────────────────────────

// Searches the Platzi Fake Store API by title, returning an array of product
// objects. An empty query fetches all products 
async function apiSearchProducts(query) {
    const url = query
        ? `${EXTERNAL_API_BASE}/products?title=${encodeURIComponent(query)}`
        : `${EXTERNAL_API_BASE}/products?`;//offset=0&limit=200000
    const res = await fetch(url);
    if (!res.ok) throw new Error('External API error: ' + res.status);
    return await res.json();
}

// Fetches a single product by its numeric ID from the external API.
// Returns null when the API responds with a non-2xx status.
async function apiFetchProduct(productId) {
    const res = await fetch(`${EXTERNAL_API_BASE}/products/${productId}`);
    if (!res.ok) return null;
    return await res.json();
}

// ── Validation helpers ─────────────────────────────────────────────────────

// Returns an error string if username fails length or character constraints,
// or null when valid. Uses a regex to replace a manual character scan (O(n)).
function validateUsername(username) {
	
	// Username too short length check
    if (!username || username.length < 5)
        return 'Username must be at least 5 characters long';
	
	// Userame too long check
    if (username.length > 40)
        return 'Username cannot exceed 40 characters in length';
	
	// Only ASCII characters check
    if (!/^[\x20-\x7E]+$/.test(username))
        return 'Error: The username must contain only ASCII printable characters.';
    return null;
}

/**
 * Uses regex to test the password requirements
*/
function validatePassword(password) {
    const complexityMsg = 'Password must be 8 characters long and contain an upper-case letter, a lower-case letter, and one special character';
	
	// empty password check
    if (!password) return complexityMsg;
	
	// Only ASCII characters check
    if (!/^[\x20-\x7E]*$/.test(password))
        return 'Password may only contain ASCII characters.';
	
	// Password too long check
    if (password.length > 40)
        return 'Password cannot exceed 40 characters in length';
	
	// Upper, Lower, and special character check. 
    if (!/^(?=.*[A-Z])(?=.*[a-z])(?=.*[!@#$%^&*()\-_+=[\]{}|;:'",.<>?/`~\\]).{8,}$/.test(password))
        return complexityMsg;
    return null;
}

// ── DB abstraction ─────────────────────────────────────────────────────────
const DB = {
    // Looks up a user row by exact username match; returns null if not found.
    async findUserByUsername(username) {
        const [rows] = await db.execute(
            'SELECT * FROM Users WHERE Username = ?', [username]);
        return rows[0] || null;
    },

    // Inserts a new user; AUTO_INCREMENT assigns the UserID. Returns the new UserID.
    async createUser(username, passwordHash) {
        const [result] = await db.execute(
            'INSERT INTO Users (Username, PasswordHash) VALUES (?, ?)',
            [username, passwordHash]);
        return result.insertId;
    },

    // Returns every row in the Products table as an array.
    async getAllStock() {
        const [rows] = await db.execute('SELECT * FROM Products');
        return rows;
    },

    // Returns the Products row for a single ID, or null if it does not exist.
    async getStockById(productId) {
        const [rows] = await db.execute(
            'SELECT * FROM Products WHERE ProductID = ?', [productId]);
        return rows[0] || null;
    },

    // Inserts a new product row with the given stock level.
    async insertProduct(productId, stock) {
        await db.execute(
            'INSERT INTO Products (ProductID, Stock) VALUES (?, ?)', [productId, stock]);
    },

    // Updates the stock level for an existing product; returns false when the
    // product ID is not found so callers can respond with 404.
    async updateStock(productId, stock) {
        const [result] = await db.execute(
            'UPDATE Products SET Stock = ? WHERE ProductID = ?', [stock, productId]);
        return result.affectedRows > 0;
    }
};

// ── Middleware ─────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(session({
    secret:            'cs380-secret-key',
    resave:            false,
    saveUninitialized: false,
    cookie:            { httpOnly: true }
}));
app.use(express.static(path.join(__dirname, '../public')));

// Rejects requests from unauthenticated sessions with 403 Forbidden.
function requireLogin(req, res, next) {
    if (req.session && req.session.userId) return next();
    res.status(403).json({ error: 'Forbidden' });
}

// ── Login (UC 02) ──────────────────────────────────────────────────────────
// Validates credentials by hashing the submitted password with SHA-256 and
// comparing it to the stored hash; establishes a session on success.
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password)
        return res.status(400).json({ error: 'Please fill in all fields.' });

    const user = await DB.findUserByUsername(username);
    if (!user)
        return res.status(401).json({ error: 'Incorrect credentials.' });

    const crypto = require('crypto');
    const hash   = crypto.createHash('sha256').update(password).digest('hex');
    if (hash !== user.PasswordHash)
        return res.status(401).json({ error: 'Incorrect credentials.' });

    req.session.userId   = user.UserID;
    req.session.username = user.Username;
    res.json({ success: true });
});

// ── Logout (UC 05) ─────────────────────────────────────────────────────────
// Destroys the server-side session, invalidating the user's cookie.
app.post('/api/logout', (req, res) => {
    req.session.destroy(() => res.json({ success: true }));
});

// ── Auth status ────────────────────────────────────────────────────────────
// Returns the current session state so the frontend can show/hide UI elements.
app.get('/api/auth', (req, res) => {
    if (req.session && req.session.userId)
        return res.json({ loggedIn: true, username: req.session.username });
    res.json({ loggedIn: false });
});

// ── Create Account (UC 01) ─────────────────────────────────────────────────
// Validates both fields, rejects duplicate usernames, then stores the new user
// with a SHA-256 password hash (consistent with the login endpoint).
app.post('/api/create-account', requireLogin, async (req, res) => {
    const { username, password, confirmPassword } = req.body;

    if (password !== confirmPassword)
        return res.status(400).json({ error: 'Passwords must match' });

    const usernameError = validateUsername(username);
    if (usernameError) return res.status(400).json({ error: usernameError });

    const passwordError = validatePassword(password);
    if (passwordError) return res.status(400).json({ error: passwordError });

    const existing = await DB.findUserByUsername(username);
    if (existing)
        return res.status(400).json({ error: 'That username is already taken' });

    try {
        const crypto       = require('crypto');
        const passwordHash = crypto.createHash('sha256').update(password).digest('hex');
        await DB.createUser(username, passwordHash);
        res.json({ success: true, message: 'Account Creation Successful' });
    } catch {
        res.status(500).json({ error: 'Error: Account was not added to the database, try creating an account again' });
    }
});

// ── Search (UC 03) ─────────────────────────────────────────────────────────
// Fetches matching products from the external API, merges stock levels from the
// local DB, and auto-assigns random stock (1–50) for any product seen for the
// first time. All lookups and merges run in O(n) via a hash map.
app.get('/api/search', requireLogin, async (req, res) => {
    const query = req.query.q || '';

    try {
        const apiProducts = await apiSearchProducts(query);
        const stockRows   = await DB.getAllStock();

        // Build an O(1)-lookup map from the flat stock array — O(m)
        const stockMap = {};
        for (const row of stockRows) stockMap[row.ProductID] = row.Stock;

        // Assign and persist stock for products not yet tracked in the DB — O(n)
        const insertPromises = [];
        for (const p of apiProducts) {
            if (stockMap[p.id] === undefined) {
                const randomStock = Math.floor(Math.random() * 50) + 1;
                stockMap[p.id] = randomStock;
                insertPromises.push(DB.insertProduct(p.id, randomStock));
            }
        }
        if (insertPromises.length > 0) await Promise.all(insertPromises);

        // Combine API metadata with local stock levels into the response shape
        const items = apiProducts.map(p => ({
            itemId: p.id,
            title:  p.title,
            images: p.images || [],
            stock:  stockMap[p.id]
        }));

        res.json({ items });
    } catch (err) {
        res.status(502).json({ error: 'Could not reach product API.' });
    }
});

// ── Edit Stock (UC 04) ─────────────────────────────────────────────────────
// Fetches live product metadata from the external API and merges it with the
// local stock level so the edit page always shows current details.
app.get('/api/items/:id', requireLogin, async (req, res) => {
    const productId = req.params.id;

    try {
        const apiProduct = await apiFetchProduct(productId);
        if (!apiProduct) return res.status(404).json({ error: 'Item not found' });

        const stockRow = await DB.getStockById(productId);
        const stock    = stockRow ? stockRow.Stock : 0;

        res.json({
            item: {
                itemId:      apiProduct.id,
                title:       apiProduct.title,
                description: apiProduct.description || '',
                images:      apiProduct.images || [],
                stock
            }
        });
    } catch {
        res.status(502).json({ error: 'Could not reach product API.' });
    }
});

// Validates the submitted stock value and writes it to the DB.
// Rejects negative numbers and values beyond MySQL INT range.
app.post('/api/items/:id/stock', requireLogin, async (req, res) => {
    const { stock } = req.body;
    const stockNum  = parseInt(stock, 10);

    if (stock === '' || stock === undefined || isNaN(stockNum) || stockNum < 0)
        return res.status(400).json({ error: 'Stock must be non-negative' });
    if (stockNum > 2147483647)
        return res.status(400).json({ error: 'Stock cannot exceed 2,147,483,647' });

    const ok = await DB.updateStock(req.params.id, stockNum);
    if (!ok) return res.status(404).json({ error: 'Item not found' });

    res.json({ success: true, stock: stockNum });
});

// ── Auth guard endpoint ────────────────────────────────────────────────────
// Lets the frontend check session validity without a full page load.
app.get('/api/guard', (req, res) => {
    if (req.session && req.session.userId)
        return res.json({ allowed: true });
    res.status(403).json({ allowed: false, error: 'Forbidden' });
});

// ── Start ──────────────────────────────────────────────────────────────────
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
