const http = require('http');
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
const https = require('https');
const TELEGRAM_BOT_TOKEN = '8196436086:AAGA_XFRB54n4MMt1yeaXc6ffNH4E3N4Vwk';
const TELEGRAM_CHAT_ID = '-4838634127';

const PORT = 3000;

// Database connection settings
const dbConfig = {
    host: 'localhost',
    user: 'Anfisa',
    password: 'juju2025Fisa',
    database: 'todolist',
};

// Функция для отправки уведомлений в Telegram
async function notifyTelegram(action, taskInfo, userId) {
    try {
        const connection = await mysql.createConnection(dbConfig);
        const [rows] = await connection.execute('SELECT username FROM users WHERE id = ?', [userId]);
        await connection.end();
        
        const username = rows.length ? rows[0].username : 'Unknown';
        let message = '';
        
        switch(action) {
            case 'add':
                message = `📝 ${username} добавил задачу: "${taskInfo.text}"`;
                break;
            case 'delete':
                message = `❌ ${username} удалил задачу: "${taskInfo.text}" (ID: ${taskInfo.id})`;
                break;
            case 'update':
                message = `✏️ ${username} изменил задачу:\nБыло: "${taskInfo.oldText}"\nСтало: "${taskInfo.newText}" (ID: ${taskInfo.id})`;
                break;
            case 'register':
                message = `👤 Новый пользователь: ${taskInfo.username}`;
                break;
            case 'login':
                message = `🔑 Пользователь ${username} вошел в систему`;
                break;
            default:
                return;
        }
        
        const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage?chat_id=${TELEGRAM_CHAT_ID}&text=${encodeURIComponent(message)}`;
        https.get(url).on('error', err => console.error('Telegram error:', err));
    } catch (error) {
        console.error('Error in Telegram notification:', error);
    }
}

// --- Функции работы с задачами ---

async function addListItem(text, userId) {
    try {
        const connection = await mysql.createConnection(dbConfig);
        const query = 'INSERT INTO items (text, user_id) VALUES (?, ?)';
        const [result] = await connection.execute(query, [text, userId]);
        await connection.end();
         // Уведомление в Telegram
        notifyTelegram('add', { text }, userId);
        return result.insertId;
    } catch (error) {
        console.error('Error adding list item:', error);
        throw error;
    }
}

async function deleteListItem(id, userId) {
    try {
        const connection = await mysql.createConnection(dbConfig);
        
        // Сначала получаем текст задачи для уведомления
        const [item] = await connection.execute('SELECT text FROM items WHERE id = ? AND user_id = ?', [id, userId]);
        if (item.length === 0) return false;
        const query = 'DELETE FROM items WHERE id = ? AND user_id = ?';
        const [result] = await connection.execute(query, [id, userId]);
        await connection.end();
        // Уведомление в Telegram
        if (result.affectedRows > 0) {
            notifyTelegram('delete', { id, text: item[0].text }, userId);
        }
        return result.affectedRows > 0;
    } catch (error) {
        console.error('Error deleting list item:', error);
        throw error;
    }
}

async function updateListItem(id, newText, userId) {
    try {
        const connection = await mysql.createConnection(dbConfig);
        
        // Сначала получаем старый текст задачи
        const [item] = await connection.execute('SELECT text FROM items WHERE id = ? AND user_id = ?', [id, userId]);
        if (item.length === 0) return false;
        
        const query = 'UPDATE items SET text = ? WHERE id = ? AND user_id = ?';
        const [result] = await connection.execute(query, [newText, id, userId]);
        await connection.end();
        
        // Уведомление в Telegram
        if (result.affectedRows > 0) {
            notifyTelegram('update', { id, oldText: item[0].text, newText }, userId);
        }
        
        return result.affectedRows > 0;
    } catch (error) {
        console.error('Error updating item:', error);
        throw error;
    }
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

// --- Регистрация пользователя ---
async function registerUser(username, password) {
    const connection = await mysql.createConnection(dbConfig);
    const passwordHash = await bcrypt.hash(password, 10);
    const query = 'INSERT INTO users (username, password_hash) VALUES (?, ?)';
    await connection.execute(query, [username, passwordHash]);
    await connection.end();
    
    // Уведомление в Telegram
    notifyTelegram('register', { username }, null);
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
    
    if (match) {
        // Уведомление в Telegram о входе
        notifyTelegram('login', {}, user.id);
        return user;
    }
    
    return false;
}

// --- Генерация HTML для задач ---
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
    return Object.fromEntries(
        cookieHeader.split(';')
            .map(c => c.trim().split('='))
            .filter(arr => arr.length === 2)
    );
}

// --- Основной обработчик ---
async function handleRequest(req, res) {
    const cookies = parseCookies(req);
    const userId = cookies.userId;
    const isAuthenticated = userId !== undefined;
    if (req.url === '/' && req.method === 'GET') {
        if (!isAuthenticated) {
            res.writeHead(302, { Location: '/login.html' });
            res.end();
            return;
        }
        try {
            const html = await fs.promises.readFile(
                path.join(__dirname, 'index.html'),
                'utf8'
            );
            const processedHtml = html.replace('{{rows}}', await getHtmlRows(userId));
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(processedHtml);
        } catch (err) {
            console.error(err);
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end('Error loading index.html');
        }
    } else if (req.url === '/login.html' && req.method === 'GET') {
        try {
            const html = await fs.promises.readFile(
                path.join(__dirname, 'login.html'),
                'utf8'
            );
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(html);
        } catch (err) {
            res.writeHead(500);
            res.end('Error loading login.html');
        }
    } else if (req.url === '/add-item' && req.method === 'POST') {
        if (!isAuthenticated) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'Not authenticated' }));
            return;
        }
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });
        req.on('end', async () => {
            try {
                const { text } = JSON.parse(body);
                await addListItem(text, userId);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));
            } catch (error) {
                console.error('Error adding item:', error);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: error.message }));
            }
        });
    } else if (req.url === '/delete-item' && req.method === 'POST') {
        if (!isAuthenticated) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'Not authenticated' }));
            return;
        }
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });
        req.on('end', async () => {
            try {
                const { id } = JSON.parse(body);
                const success = await deleteListItem(id, userId);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success }));
            } catch (error) {
                console.error('Error deleting item:', error);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: error.message }));
            }
        });
    } else if (req.url === '/update-item' && req.method === 'POST') {
        if (!isAuthenticated) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'Not authenticated' }));
            return;
        }
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });
        req.on('end', async () => {
            try {
                const { id, newText } = JSON.parse(body);
                const success = await updateListItem(id, newText, userId);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success }));
            } catch (error) {
                console.error('Error updating item:', error);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: error.message }));
            }
        });

    } else if (req.url === '/register' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', async () => {
            const { username, password } = JSON.parse(body);
            try {
                await registerUser(username, password);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));
            } catch (err) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: err.message }));
            }
        });
    } else if (req.url.startsWith('/login') && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', async () => {
            const { username, password } = JSON.parse(body);
            try {
                const user = await authenticateUser(username, password);
                if (user) {
                    res.writeHead(200, {
                        'Content-Type': 'application/json',
                        'Set-Cookie': `userId=${user.id}; Path=/; HttpOnly`
                    });
                    res.end(JSON.stringify({ success: true }));
                } else {
                    res.writeHead(401, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, message: 'Invalid credentials' }));
                }
            } catch (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: err.message }));
            }
        });
    } else if (req.url === '/logout' && req.method === 'POST') {
        res.writeHead(302, {
            'Set-Cookie': 'userId=; Max-Age=0; Path=/; HttpOnly',
            'Location': '/login.html'
        });
        res.end();
    } else if (req.method === 'GET') {
        const filePath = path.join(__dirname, req.url.slice(1));
        if (fs.existsSync(filePath)) {
            const ext = path.extname(filePath);
            const mime = {
                '.html': 'text/html',
                '.css': 'text/css',
                '.js': 'application/javascript',
            }[ext] || 'text/plain';

            const content = await fs.promises.readFile(filePath);
            res.writeHead(200, { 'Content-Type': mime });
            res.end(content);
        }
    } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Route not found');
    }
}

// Create and start server
const server = http.createServer(handleRequest);
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
