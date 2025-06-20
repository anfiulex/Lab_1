const http = require('http');
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');

const PORT = 3000;

// Database connection settings
const dbConfig = {
    host: 'localhost',
    user: 'Anfisa',
    password: 'juju2025Fisa',
    database: 'todolist',
  };

  async function addListItem(userId, text) {
    try {
        const connection = await mysql.createConnection(dbConfig);
        const query = 'INSERT INTO items (user_id, text) VALUES (?, ?)';
        const [result] = await connection.execute(query, [userId, text]);
        await connection.end();
        return result.insertId;
    } catch (error) {
        console.error('Error adding list item:', error);
        throw error;
    }
}

async function deleteListItem(userId, id) {
    try {
        const connection = await mysql.createConnection(dbConfig);
        const query = 'DELETE FROM items WHERE id = ? AND user_id = ?';
        const [result] = await connection.execute(query, [id, userId]);
        await connection.end();
        return result.affectedRows > 0;
    } catch (error) {
        console.error('Error deleting list item:', error);
        throw error;
    }
}

async function updateListItem(userId, id, newText) {
    try {
        const connection = await mysql.createConnection(dbConfig);
        const query = 'UPDATE items SET text = ? WHERE id = ? AND user_id = ?';
        const [result] = await connection.execute(query, [newText, id, userId]);
        await connection.end();
        return result.affectedRows > 0;
    } catch (error) {
        console.error('Error updating item:', error);
        throw error;
    }
}

// --- Регистрация пользователя ---
async function registerUser(username, password) {
    const connection = await mysql.createConnection(dbConfig);
    const passwordHash = await bcrypt.hash(password, 10);
    const query = 'INSERT INTO users (username, password_hash) VALUES (?, ?)';
    await connection.execute(query, [username, passwordHash]);
    await connection.end();
}

// --- Аутентификация пользователя ---
async function authenticateUser(username, password) {
    const connection = await mysql.createConnection(dbConfig);
    const query = 'SELECT * FROM users WHERE username = ?';
    const [rows] = await connection.execute(query, [username]);
    await connection.end();

    if (rows.length === 0) return false;

    const user = rows[0];
    const match = await bcrypt.compare(password, user.password_hash);
    return match ? user : false;
}

  async function retrieveListItems(userId) {
    try {
        const connection = await mysql.createConnection(dbConfig);
        const query = 'SELECT id, text FROM items WHERE user_id = ?';
        const [rows] = await connection.execute(query, [userId]);
        await connection.end();
        return rows;
    } catch (error) {
        console.error('Error retrieving list items:', error);
        throw error;
    }
}

// Stub function for generating HTML rows
async function getHtmlRows(userId) {
    const todoItems = await retrieveListItems(userId);
    return todoItems.map((item, index) => `
        <tr data-id="${item.id}">
            <td>${index + 1}</td>
            <td>${item.text}</td>
            <td>
                <button onclick="enableEdit(${item.id}, '${item.text.replace(/'/g, "\\'")}')">✎</button>
                <button onclick="removeItem(${item.id})">×</button>
            </td>
        </tr>
    `).join('');
}

function parseCookies(req) {
    const cookieHeader = req.headers.cookie || '';
    return Object.fromEntries(cookieHeader.split(';').map(c => c.trim().split('=')));
}

// Modified request handler with template replacement
async function handleRequest(req, res) {
    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;
    const cookies = parseCookies(req);
    const userId = parseInt(cookies.userId); // <--- userId из cookies

    if (!userId) {
        res.writeHead(302, { Location: '/login.html' });
        res.end();
        return;
    }

    if (pathname === '/') {
        const html = fs.readFileSync('./public/index.html', 'utf8');
        const processedHtml = html.replace('{{rows}}', await getHtmlRows(userId)); // передаём userId
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(processedHtml);

    } else if (pathname === '/add-item' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            const { text } = JSON.parse(body);
            await addListItem(userId, text); // передаём userId
            res.writeHead(200);
            res.end();
        });

    } else if (pathname === '/delete-item' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            const { id } = JSON.parse(body);
            const success = await deleteListItem(userId, id); // передаём userId
            res.writeHead(success ? 200 : 404);
            res.end();
        });

    } else if (pathname === '/update-item' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            const { id, text } = JSON.parse(body);
            const success = await updateListItem(userId, id, text); // передаём userId
            res.writeHead(success ? 200 : 404);
            res.end();
        });

    } else if (pathname === '/logout') {
        res.writeHead(302, {
            'Set-Cookie': 'userId=; HttpOnly; Max-Age=0',
            'Location': '/login.html'
        });
        res.end();

    } else {
        const filePath = './public' + pathname;
        fs.readFile(filePath, (err, data) => {
            if (err) {
                res.writeHead(404);
                res.end('File not found');
                return;
            }
            const ext = path.extname(filePath).toLowerCase();
            const mimeTypes = {
                '.html': 'text/html',
                '.css': 'text/css',
                '.js': 'application/javascript'
            };
            const contentType = mimeTypes[ext] || 'application/octet-stream';
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(data);
        });
    }
}

// Create and start server
const server = http.createServer(handleRequest);
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));