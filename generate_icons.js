const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// We can create SVG files and convert or render raw PNGs
const generateSvg = (size) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${Math.floor(size * 0.22)}" fill="#121212"/>
  <circle cx="${size * 0.5}" cy="${size * 0.5}" r="${size * 0.4}" fill="#1DB954"/>
  <!-- Chat Bubble -->
  <path d="M${size * 0.3} ${size * 0.35} C${size * 0.3} ${size * 0.28}, ${size * 0.35} ${size * 0.25}, ${size * 0.5} ${size * 0.25} C${size * 0.65} ${size * 0.25}, ${size * 0.7} ${size * 0.28}, ${size * 0.7} ${size * 0.35} C${size * 0.7} ${size * 0.45}, ${size * 0.6} ${size * 0.5}, ${size * 0.52} ${size * 0.52} L${size * 0.52} ${size * 0.62} C${size * 0.52} ${size * 0.65}, ${size * 0.48} ${size * 0.65}, ${size * 0.48} ${size * 0.62} L${size * 0.48} ${size * 0.5} C${size * 0.48} ${size * 0.46}, ${size * 0.54} ${size * 0.43}, ${size * 0.6} ${size * 0.38} C${size * 0.62} ${size * 0.36}, ${size * 0.62} ${size * 0.34}, ${size * 0.5} ${size * 0.34} C${size * 0.38} ${size * 0.34}, ${size * 0.38} ${size * 0.36}, ${size * 0.3} ${size * 0.35} Z" fill="#FFFFFF"/>
</svg>`;

// We will also use pure canvas / PNG buffer generator or write SVG/PNG files
console.log('Generating extension icons...');

// Simple PNG generator in pure JS to guarantee valid binary PNG files without external native dependencies
function createSolidColorPng(width, height, r, g, b, a = 255) {
  const zlib = require('zlib');
  
  // PNG signature
  const signature = Buffer.from([139, 80, 78, 71, 13, 10, 26, 10]);
  
  // IHDR chunk
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // Bit depth
  ihdr[9] = 6; // Color type (RGBA)
  ihdr[10] = 0; // Compression
  ihdr[11] = 0; // Filter
  ihdr[12] = 0; // Interlace

  const ihdrChunk = createChunk('IHDR', ihdr);
  
  // IDAT chunk data
  const rowSize = width * 4 + 1;
  const rawData = Buffer.alloc(rowSize * height);
  
  const cx = width / 2;
  const cy = height / 2;
  const radius = width * 0.42;
  
  for (let y = 0; y < height; y++) {
    const rowOffset = y * rowSize;
    rawData[rowOffset] = 0; // None filter
    for (let x = 0; x < width; x++) {
      const pxOffset = rowOffset + 1 + x * 4;
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx*dx + dy*dy);
      
      if (dist <= radius) {
        // Spotify Green #1DB954
        rawData[pxOffset] = 0x1D;
        rawData[pxOffset + 1] = 0xB9;
        rawData[pxOffset + 2] = 0x54;
        rawData[pxOffset + 3] = 255;
      } else {
        // Dark Spotify #121212
        rawData[pxOffset] = 0x12;
        rawData[pxOffset + 1] = 0x12;
        rawData[pxOffset + 2] = 0x12;
        rawData[pxOffset + 3] = 255;
      }
    }
  }
  
  const compressed = zlib.deflateSync(rawData);
  const idatChunk = createChunk('IDAT', compressed);
  
  // IEND chunk
  const iendChunk = createChunk('IEND', Buffer.alloc(0));
  
  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

function createChunk(type, data) {
  const len = data.length;
  const buf = Buffer.alloc(4 + 4 + len + 4);
  buf.writeUInt32BE(len, 0);
  buf.write(type, 4);
  data.copy(buf, 8);
  
  // CRC32
  const crc = crc32(Buffer.concat([Buffer.from(type), data]));
  buf.writeInt32BE(crc, 8 + len);
  return buf;
}

function crc32(buf) {
  let crc = -1;
  for (let i = 0; i < buf.length; i++) {
    const byte = buf[i];
    for (let j = 0; j < 8; j++) {
      const bit = (byte ^ crc) & 1;
      crc = (crc >>> 1) ^ (bit ? 0xEDB88320 : 0);
    }
  }
  return crc ^ -1;
}

[16, 48, 128].forEach(size => {
  const iconBuffer = createSolidColorPng(size, size);
  fs.writeFileSync(path.join(__dirname, 'icons', `icon${size}.png`), iconBuffer);
  console.log(`Created icon${size}.png`);
});
