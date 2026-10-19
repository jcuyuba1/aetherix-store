const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const paypal = require('@paypal/checkout-server-sdk');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const vaultDir = path.join(__dirname, 'vault_files');
const imgDir = path.join(__dirname, 'public', 'images');
const dbFile = path.join(__dirname, 'database.json');
const reviewsFile = path.join(__dirname, 'reviews.json');

if (!fs.existsSync(vaultDir)) fs.mkdirSync(vaultDir, { recursive: true });
if (!fs.existsSync(imgDir)) fs.mkdirSync(imgDir, { recursive: true });

const ADMIN_PASSWORD = "TuContraseñaSecreta123";

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    if (file.fieldname === 'appImage') cb(null, imgDir);
    else cb(null, vaultDir);
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + '-' + file.originalname);
  }
});
const upload = multer({ storage: storage });

const defaultCatalog = [
  { id: "1", title: "ADBLOCK APP", file: "pro_shield_v3.apk", image: "default", price: 2.00, tag: "Android APK", desc: "HERRAMIENTA AVANZADA PARA QUITAR ANUNCIOS A TUS JUEGOS" },
  { id: "2", title: "Quantum Net Tools", file: "quantum_tools.apk", image: "default", price: 14.99, tag: "Android APK", desc: "Suite profesional de análisis de paquetes." },
  { id: "3", title: "DevPack Studio PC", file: "devpack_setup.zip", image: "default", price: 24.99, tag: "Programas", desc: "Entorno de desarrollo local preconfigurado." },
  { id: "4", title: "RetroArch Emulator X", file: "retroarch_setup.zip", image: "default", price: 12.00, tag: "Emuladores", desc: "Emulador multiconsola definitivo para PC y Android." }
];

if (!fs.existsSync(dbFile)) fs.writeFileSync(dbFile, JSON.stringify(defaultCatalog, null, 2));
if (!fs.existsSync(reviewsFile)) fs.writeFileSync(reviewsFile, JSON.stringify({ "1": [], "2": [], "3": [], "4": [] }, null, 2));

function getCatalog() {
  try {
    const data = fs.readFileSync(dbFile, 'utf8');
    const parsed = JSON.parse(data);
    return (!parsed || parsed.length === 0) ? defaultCatalog : parsed;
  } catch (e) { return defaultCatalog; }
}

function saveCatalog(data) { fs.writeFileSync(dbFile, JSON.stringify(data, null, 2)); }

function getReviews() {
  try { return JSON.parse(fs.readFileSync(reviewsFile, 'utf8')); } catch (e) { return {}; }
}
function saveReviews(data) { fs.writeFileSync(reviewsFile, JSON.stringify(data, null, 2)); }

// --- CREDENCIALES LIVE OFICIALES DE TU PANEL (LIMPIAS DE ESPACIOS) ---
function getPayPalClient() {
  const clientId = "BAA04kgu3t2iSl40-Bep9eKGE4F9YpGLDnqnz-Tk7yqoRJpBvJrYDBx21PbquHbDDbziC-7_zA14rbhVz0".trim();
  // Se han unido correctamente los fragmentos de tu clave secreta de Live para evitar fallos
  const clientSecret = "EKeiGR2rVjipJ7dNUo0TZ8Gzlpjm1EKgI3xN46TXY_78lbFV3JESYSrbIiprhRglK1hXxtVxoECqdhqR".replace(/\s+/g, '');
  const environment = new paypal.core.LiveEnvironment(clientId, clientSecret);
  return new paypal.core.PayPalHttpClient(environment);
}

const validDownloadTokens = new Map();
const pendingOrders = new Map();

app.get('/api/products', (req, res) => res.json(getCatalog()));

app.post('/api/orders/create', async (req, res) => {
  try {
    const client = getPayPalClient();
    const { cart } = req.body;
    if (!cart || cart.length === 0) return res.status(400).json({ error: "El carrito está vacío." });

    const catalog = getCatalog();
    let totalAmount = 0;
    cart.forEach(item => {
      const product = catalog.find(p => p.id === item.id);
      if (product) totalAmount += product.price * item.quantity;
    });

    const request = new paypal.orders.OrdersCreateRequest();
    request.prefer("return=representation");
    request.requestBody({
      intent: "CAPTURE",
      purchase_units: [{
        amount: { currency_code: "USD", value: totalAmount.toFixed(2) },
        description: "Compra oficial en Aetherix Store"
      }]
    });

    const order = await client.execute(request);
    pendingOrders.set(order.result.id, cart);
    res.json({ id: order.result.id });
  } catch (err) {
    console.error("Error creando orden Live:", err);
    res.status(500).json({ error: "No se pudo procesar la orden en modo Live." });
  }
});

app.post('/api/orders/capture', async (req, res) => {
  try {
    const client = getPayPalClient();
    const { orderId } = req.body;
    const request = new paypal.orders.OrdersCaptureRequest(orderId);
    request.requestBody({});

    const capture = await client.execute(request);
    if (capture.result.status === "COMPLETED") {
      const buyerEmail = capture.result.payer.email_address;
      const cart = pendingOrders.get(orderId) || [];
      const catalog = getCatalog();
      const downloads = [];

      cart.forEach(item => {
        const product = catalog.find(p => p.id === item.id);
        if (product) {
          for (let i = 0; i < item.quantity; i++) {
            const token = Math.random().toString(36).substring(2) + Date.now().toString(36);
            validDownloadTokens.set(token, { fileName: product.file, expires: Date.now() + 30 * 60 * 1000 });
            downloads.push({ name: product.title, url: `/api/download/${token}` });
          }
        }
      });

      pendingOrders.delete(orderId);
      return res.json({ success: true, buyerEmail, downloads });
    }
    res.status(400).json({ error: "El pago no se completó." });
  } catch (err) {
    res.status(500).json({ error: "Error al capturar el pago." });
  }
});

app.get('/api/download/:token', (req, res) => {
  const session = validDownloadTokens.get(req.params.token);
  if (!session) return res.status(403).send("Enlace no válido.");
  if (Date.now() > session.expires) {
    validDownloadTokens.delete(req.params.token);
    return res.status(410).send("Enlace expirado.");
  }
  res.download(path.join(vaultDir, session.fileName));
});

app.get('/api/reviews/:id', (req, res) => {
  const reviewsDb = getReviews();
  const reviews = reviewsDb[req.params.id] || [];
  const total = reviews.reduce((acc, r) => acc + r.rating, 0);
  const average = reviews.length > 0 ? (total / reviews.length).toFixed(1) : 0;
  res.json({ average, count: reviews.length, reviews });
});

app.post('/api/reviews', (req, res) => {
  const { productId, name, rating, comment } = req.body;
  let reviewsDb = getReviews();
  if (!reviewsDb[productId]) reviewsDb[productId] = [];
  
  reviewsDb[productId].unshift({
    name: name || "Anónimo",
    rating: Number(rating) || 5,
    comment: comment || "",
    date: new Date().toLocaleDateString('es-PE')
  });
  saveReviews(reviewsDb);
  res.json({ success: true });
});

app.post('/api/admin/upload', upload.fields([{ name: 'appImage', maxCount: 1 }, { name: 'appFile', maxCount: 1 }]), (req, res) => {
  const { adminPassword, title, tag, desc, price } = req.body;
  if (adminPassword !== ADMIN_PASSWORD) return res.status(403).json({ error: "Contraseña maestra incorrecta." });

  let catalog = getCatalog();
  const newProduct = {
    id: Date.now().toString(),
    title,
    tag,
    desc,
    price: parseFloat(price) || 0,
    file: req.files && req.files['appFile'] ? req.files['appFile'][0].filename : "default_file.zip",
    image: req.files && req.files['appImage'] ? req.files['appImage'][0].filename : "default"
  };

  catalog.push(newProduct);
  saveCatalog(catalog);
  res.json({ success: true, message: "¡Aplicación publicada con éxito!" });
});

app.put('/api/admin/edit/:id', upload.fields([{ name: 'appImage', maxCount: 1 }, { name: 'appFile', maxCount: 1 }]), (req, res) => {
  const { adminPassword, title, tag, desc, price } = req.body;
  if (adminPassword !== ADMIN_PASSWORD) return res.status(403).json({ error: "Contraseña maestra incorrecta." });

  let catalog = getCatalog();
  const index = catalog.findIndex(p => p.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: "Aplicación no encontrada." });

  catalog[index].title = title || catalog[index].title;
  catalog[index].tag = tag || catalog[index].tag;
  catalog[index].desc = desc || catalog[index].desc;
  catalog[index].price = price ? parseFloat(price) : catalog[index].price;

  if (req.files && req.files['appFile']) catalog[index].file = req.files['appFile'][0].filename;
  if (req.files && req.files['appImage']) catalog[index].image = req.files['appImage'][0].filename;

  saveCatalog(catalog);
  res.json({ success: true, message: "¡Aplicación actualizada correctamente!" });
});

app.delete('/api/admin/delete/:id', (req, res) => {
  const { adminPassword } = req.body;
  if (adminPassword !== ADMIN_PASSWORD) return res.status(403).json({ error: "Contraseña maestra incorrecta." });

  let catalog = getCatalog();
  catalog = catalog.filter(p => p.id !== req.params.id);
  saveCatalog(catalog);
  res.json({ success: true, message: "Aplicación eliminada." });
});

app.listen(3000, () => console.log('Servidor activo y estable en modo Live en http://localhost:3000'));