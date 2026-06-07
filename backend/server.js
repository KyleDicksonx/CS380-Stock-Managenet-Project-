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
const bcrypt  = require('bcryptjs');
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

async function initDB() {
    // Connect without specifying a database so we can run DROP/CREATE DATABASE
    const conn = await mysql.createConnection(dbConfig);

    await conn.query('DROP DATABASE IF EXISTS inventory_db');
    await conn.query('CREATE DATABASE IF NOT EXISTS inventory_db');
    await conn.query('USE inventory_db');

    await conn.query(`
        CREATE TABLE Users(
            UserID int primary key NOT NULL,
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
        INSERT INTO Users(UserID, Username, PasswordHash)
        VALUES
            (1, 'Tester001', SHA2('P@ssw0rd123', 256)),
            (2, '1',         SHA2('1', 256))
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
        console.warn('MySQL not available – using in-memory store for demo.');
        console.warn(err.message);
        db = null;
    }
})();

// ── In-memory fallback for Users only (demo without MySQL) ───────────────
const memStore = {
    users: [
        { UserID: 1, Username: 'Tester001',
          PasswordHash: 'ef92b778bafe771207b9df4e14c05082c3c3f536e71f6b0cbe06cee9d81bd2e0' } // SHA-256 of P@ssw0rd123
    ],
    products: [],   // populated at runtime via insertProduct
    nextUserID: 2
};

// ── External API helpers ───────────────────────────────────────────────────

/**
 * Search products by title from the Platzi Fake Store API.
 * GET /api/v1/products?title=<query>
 * Returns [{ id, title, price, description, category, images }, ...]
 * Empty query fetches first 20 products.
 */
async function apiSearchProducts(query) {
    const url = query
        ? `${EXTERNAL_API_BASE}/products?title=${encodeURIComponent(query)}`
        : `${EXTERNAL_API_BASE}/products?offset=0&limit=200000`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('External API error: ' + res.status);
    return await res.json(); // [{ id, title, ... }]
}

/**
 * Fetch a single product by ID from the Platzi Fake Store API.
 * GET /api/v1/products/<id>
 * Returns { id, title, price, description, category, images } or throws.
 */
async function apiFetchProduct(productId) {
    const res = await fetch(`${EXTERNAL_API_BASE}/products/${productId}`);
    if (!res.ok) return null;
    return await res.json();
}

// ── Validation helpers ─────────────────────────────────────────────────────

function validateUsername(username) {
    if (!username || username.length === 0)
        return 'Username must be at least 5 characters long';
    if (username.length < 5)
        return 'Username must be at least 5 characters long';
    if (username.length > 40)
        return 'Username cannot exceed 40 characters in length';
    for (let i = 0; i < username.length; i++) {
        const code = username.charCodeAt(i);
        if (code < 0x20 || code > 0x7E)
            return 'Error: The username must contain only ASCII printable characters.';
    }
    return null;
}

function validatePassword(password) {
    if (!password || password.length === 0)
        return 'Password must be 8 characters long and contain an upper-case letter, a lower-case letter, and one special character';
    for (let i = 0; i < password.length; i++) {
        const code = password.charCodeAt(i);
        if (code < 0x20 || code > 0x7E)
            return 'Password may only contain ASCII characters.';
    }
    if (password.length > 40)
        return 'Password cannot exceed 40 characters in length';
    if (password.length < 8)
        return 'Password must be 8 characters long and contain an upper-case letter, a lower-case letter, and one special character';
    let hasUpper = false, hasLower = false, hasSpecial = false;
    const specials = new Set('!@#$%^&*()_+-=[]{}|;:\'",.<>?/`~\\');
    for (const ch of password) {
        if      (ch >= 'A' && ch <= 'Z') hasUpper  = true;
        else if (ch >= 'a' && ch <= 'z') hasLower  = true;
        else if (specials.has(ch))       hasSpecial = true;
    }
    if (!hasUpper || !hasLower || !hasSpecial)
        return 'Password must be 8 characters long and contain an upper-case letter, a lower-case letter, and one special character';
    return null;
}

// ── DB abstraction ─────────────────────────────────────────────────────────
const DB = {
    async findUserByUsername(username) {
        if (db) {
            const [rows] = await db.execute(
                'SELECT * FROM Users WHERE Username = ?', [username]);
            return rows[0] || null;
        }
        return memStore.users.find(u => u.Username === username) || null;
    },
    async createUser(username, passwordHash) {
        if (db) {
            const [rows] = await db.execute('SELECT MAX(UserID) AS maxId FROM Users');
            const nextId = (rows[0].maxId || 0) + 1;
            await db.execute(
                'INSERT INTO Users (UserID, Username, PasswordHash) VALUES (?, ?, ?)',
                [nextId, username, passwordHash]);
            return nextId;
        }
        const UserID = memStore.nextUserID++;
        memStore.users.push({ UserID, Username: username, PasswordHash: passwordHash });
        return UserID;
    },
    async getAllStock() {
        if (db) {
            const [rows] = await db.execute('SELECT * FROM Products');
            return rows;
        }
        return memStore.products;
    },
    async getStockById(productId) {
        if (db) {
            const [rows] = await db.execute(
                'SELECT * FROM Products WHERE ProductID = ?', [productId]);
            return rows[0] || null;
        }
        return memStore.products.find(p => p.ProductID === parseInt(productId)) || null;
    },
    async insertProduct(productId, stock) {
        if (db) {
            await db.execute(
                'INSERT INTO Products (ProductID, Stock) VALUES (?, ?)', [productId, stock]);
            return;
        }
        memStore.products.push({ ProductID: parseInt(productId), Stock: stock });
    },
    async updateStock(productId, stock) {
        if (db) {
            const [result] = await db.execute(
                'UPDATE Products SET Stock = ? WHERE ProductID = ?', [stock, productId]);
            return result.affectedRows > 0;
        }
        const product = memStore.products.find(p => p.ProductID === parseInt(productId));
        if (!product) return false;
        product.Stock = stock;
        return true;
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
// Force browser to always revalidate HTML pages — prevents back button from
// serving a cached copy and ensures stock values are always fresh.
app.use((req, res, next) => {
    if (req.path.endsWith('.html') || req.path === '/') {
        res.setHeader('Cache-Control', 'no-store');
    }
    next();
});
app.use(express.static(path.join(__dirname, '../public')));

function requireLogin(req, res, next) {
    if (req.session && req.session.userId) return next();
    res.status(403).json({ error: 'Forbidden' });
}

// ── Login (UC 02) ──────────────────────────────────────────────────────────
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
app.post('/api/logout', (req, res) => {
    req.session.destroy(() => res.json({ success: true }));
});

// ── Auth status ────────────────────────────────────────────────────────────
app.get('/api/auth', (req, res) => {
    if (req.session && req.session.userId)
        return res.json({ loggedIn: true, username: req.session.username });
    res.json({ loggedIn: false });
});

// ── Create Account (UC 01) ─────────────────────────────────────────────────
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
// Fetches matching products from the external API, merges stock from DB.
app.get('/api/search', requireLogin, async (req, res) => {
    const query = req.query.q || '';

    try {
        // 1. Get matching products (with titles) from external API — O(n)
        const apiProducts = await apiSearchProducts(query);

        // 2. Get all stock rows from DB — O(m)
        const stockRows = await DB.getAllStock();

        // 3. Build stock lookup map keyed by ProductID — O(m)
        const stockMap = {};
        for (const row of stockRows) stockMap[row.ProductID] = row.Stock;

        // 4. For any API product not yet in DB, insert with random stock 1-50 — O(n)
        const insertPromises = [];
        for (const p of apiProducts) {
            if (stockMap[p.id] === undefined) {
                const randomStock = Math.floor(Math.random() * 50) + 1;
                stockMap[p.id] = randomStock;
                insertPromises.push(DB.insertProduct(p.id, randomStock));
            }
        }
        if (insertPromises.length > 0) await Promise.all(insertPromises);

        // 5. Merge stock into API results — O(n)
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
// GET: fetch product details from external API + stock from DB
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

// POST: update stock in DB only
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
app.get('/api/guard', (req, res) => {
    if (req.session && req.session.userId)
        return res.json({ allowed: true });
    res.status(403).json({ allowed: false, error: 'Forbidden' });
});

// ── Start ──────────────────────────────────────────────────────────────────
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
