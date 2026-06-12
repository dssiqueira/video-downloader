// Script para gerar ícones PNG simples usando Canvas (Node.js com canvas)
// Execute: node create-icons.js
// Ou use qualquer ferramenta de design para criar os ícones manualmente.

// Se não tiver o pacote canvas instalado, os ícones placeholder abaixo
// são suficientes para carregar a extensão no Chrome em modo desenvolvedor.

const { createCanvas } = require("canvas");
const fs = require("fs");
const path = require("path");

const sizes = [16, 48, 128];

sizes.forEach((size) => {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext("2d");

  // Background circle
  ctx.fillStyle = "#000000";
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  ctx.fill();

  // Download arrow
  ctx.fillStyle = "#1d9bf0";
  const s = size / 24;

  ctx.beginPath();
  // Arrow body
  ctx.rect(10 * s, 4 * s, 4 * s, 8 * s);
  ctx.fill();

  ctx.beginPath();
  // Arrow head
  ctx.moveTo(7 * s, 12 * s);
  ctx.lineTo(12 * s, 17 * s);
  ctx.lineTo(17 * s, 12 * s);
  ctx.closePath();
  ctx.fill();

  ctx.beginPath();
  // Bottom bar
  ctx.rect(5 * s, 18 * s, 14 * s, 2 * s);
  ctx.fill();

  const buffer = canvas.toBuffer("image/png");
  fs.writeFileSync(path.join(__dirname, `icon${size}.png`), buffer);
  console.log(`Created icon${size}.png`);
});
