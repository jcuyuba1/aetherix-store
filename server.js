const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');

const app = express();

// Configuración esencial para servir la carpeta public y procesar JSON
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Configuración de almacenamiento para los archivos subidos
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, 'vault_files');
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname);
  }
});
const upload = multer({ storage });

// Archivos de base de datos JSON locales
const DB_FILE = path.join(__dirname, 'database.json');
const REVIEWS_FILE = path.join(__dirname, 'reviews.json');

function getProducts() {
  if (!fs.existsSync(DB_FILE)) return [];
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}

function getReviews() {
  if (!fs.existsSync(REVIEWS_FILE)) return {};
  return JSON.parse(fs.readFileSync(REVIEWS_FILE, 'utf8'));
}

// Rutas de la API de productos
app.get('/api/products', (req, res) => {
  const products = getProducts();
  res.json(products);
});

app.get('/api/reviews/:id', (req, res) => {
  const reviewsData = getReviews();
  const productId = req.params.id;
  const productReviews = reviewsData[productId] || [];
  
  let average = "0.0";
  if (productReviews.length > 0) {
    const sum = productReviews.reduce((acc, r) => acc + Number(r.rating), 0);
    average = (sum / productReviews.length).toFixed(1);
  }
  
  res.json({ average, count: productReviews.length, reviews: productReviews });
});

app.post('/api/reviews', (req, res) => {
  const { productId, name, rating, comment } = req.body;
  const reviewsData = getReviews();
  if (!reviewsData[productId]) reviewsData[productId] = [];
  
  reviewsData[productId].unshift({
    name,
    rating,
    comment,
    date: new Date().toLocaleDateString()
  });
  
  fs.writeFileSync(REVIEWS_FILE, JSON.stringify(reviewsData, null, 2));
  res.json({ success: true });
});

// Simulación de creación y captura de órdenes PayPal
app.post('/api/orders/create', (req, res) => {
  const fakeOrderId = 'ORDER-' + Math.floor(Math.random() * 1000000);
  res.json({ id: fakeOrderId });
});

app.post('/api/orders/capture', (req, res) => {
  const products = getProducts();
  const downloads = products.slice(0, 2).map(p => ({
    name: p.title,
    url: `/download/${p.id}`
  }));

  res.json({
    success: true,
    buyerEmail: "comprador@example.com",
    downloads: downloads
  });
});

// Ruta para descargas protegidas
app.get('/download/:id', (req, res) => {
  const products = getProducts();
  const product = products.find(p => p.id === req.params.id);
  if (product && product.file) {
    const filePath = path.join(__dirname, 'vault_files', product.file);
    if (fs.existsSync(filePath)) {
      return res.download(filePath);
    }
  }
  res.status(404).send('Archivo no encontrado o enlace expirado.');
});

// Ruta comodín compatible con Express moderno (Evita el error de path-to-regexp)
app.get(/^\/.*/, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Puerto dinámico obligatorio para Render
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor corriendo correctamente en el puerto ${PORT}`);
});