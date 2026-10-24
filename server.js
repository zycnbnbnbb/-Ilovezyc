const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const server = http.createServer((req, res) => {
  let urlPath = req.url.split('?')[0]; 
  let filePath = '.' + urlPath;
  if (filePath === './') filePath = './index.html';
  
  const extname = path.extname(filePath);
  let contentType = 'text/html';
  if (extname === '.js') contentType = 'text/javascript';
  if (extname === '.css') contentType = 'text/css';
  if (extname === '.png') contentType = 'image/png';
  if (extname === '.svg') contentType = 'image/svg+xml';

  fs.readFile(filePath, (error, content) => {
    if (error) { 
      res.writeHead(404); 
      res.end('Not Found'); 
    } else { 
      res.writeHead(200, { 'Content-Type': contentType }); 
      res.end(content, 'utf-8'); 
    }
  });
});

const wss = new WebSocket.Server({ server });
const rooms = new Map(); 

wss.on('connection', (ws) => {
  ws.on('message', (message) => {
    try {
      const msg = JSON.parse(message);
      if (msg.type === 'auth' && msg.role === 'viewer') {
        ws.room = msg.room;
        if (!rooms.has(ws.room)) rooms.set(ws.room, new Set());
        rooms.get(ws.room).add(ws);
        
        ws.send(JSON.stringify({ type: 'auth_ok' }));
        ws.send(JSON.stringify({ type: 'host_online' }));
        ws.send(JSON.stringify({ type: 'config', webFps: 60 }));
      }
    } catch(e) {}
  });
  ws.on('close', () => {
    if (ws.room && rooms.has(ws.room)) rooms.get(ws.room).delete(ws);
  });
});

setInterval(() => {
  const room = '123456';
  if (!rooms.has(room) || rooms.get(room).size === 0) return;
  
  const count = 5; 
  const buffer = Buffer.alloc(12 + count * 28);
  
  buffer.writeUInt8(0x04, 0); 
  buffer.writeUInt8(1, 1);    
  buffer.writeUInt8(1, 2);    
  buffer.writeUInt8(count, 3); 
  buffer.writeUInt32LE(Date.now() % 100000, 4); 
  
  let off = 12;
  for (let i = 0; i < count; i++) {
    buffer.writeUInt32LE(1000 + i, off); off += 4; 
    
    const time = Date.now() / 1000;
    const x = Math.sin(time + i) * 3000; 
    const y = Math.cos(time + i) * 3000;
    
    buffer.writeFloatLE(x, off); off += 4;
    buffer.writeFloatLE(y, off); off += 4;
    buffer.writeFloatLE(0, off); off += 4; 
    buffer.writeFloatLE(100, off); off += 4; 
    buffer.writeUInt8(i === 0 ? 1 : 2, off); off += 1; 
    buffer.writeUInt16LE(3005 + i, off); off += 2; 
    buffer.writeUInt8(1, off); off += 1; 
    buffer.writeUInt8(i === 0 ? 1 : 0, off); off += 1; 
    buffer.writeUInt8(0, off); off += 1; 
    off += 2; 
  }
  
  for (const client of rooms.get(room)) {
    if (client.readyState === WebSocket.OPEN) client.send(buffer);
  }
}, 50);

const port = process.env.PORT || 3000;
server.listen(port, () => console.log(`Server listening on port ${port}`));