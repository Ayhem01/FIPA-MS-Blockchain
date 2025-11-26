require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const web3Service = require('./services/web3Service');

const app = express();
const PORT = process.env.PORT || 3000;
app.set('json replacer', (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
app.set('json spaces', process.env.NODE_ENV === 'development' ? 2 : 0);

/* ---------------- Middleware Globaux ---------------- */
app.use(helmet());

const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim())
  : '*';

app.use(cors({
  origin: allowedOrigins,
  credentials: true,
}));

app.use(morgan(process.env.NODE_ENV === 'development' ? 'dev' : 'combined'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/api/tx', require('./routes/hash'));


/* ---------------- Routes de diagnostic ---------------- */
app.get('/health', (_req, res) => {
  res.status(200).json({
    success: true,
    service: 'CRM FIPA Microservice',
    status: 'OK',
    timestamp: new Date().toISOString(),
  });
});

app.all('/api/ping', (_req, res) => {
  res.json({ success: true, message: 'pong', service: 'CRM FIPA Microservice' });
});

/* ---------------- Montage des routes ---------------- */
function safeMount(prefix, relPath) {
  try {
    const router = require(relPath);
    if (router && typeof router === 'function') {
      app.use(prefix, router);
      console.log(`✅ Mounted routes at ${prefix} from ${relPath}`);
    } else {
      console.error(`❌ Router at ${relPath} is invalid (not a function export).`);
    }
  } catch (e) {
    console.error(`❌ Failed to mount ${relPath}: ${e.message}`);
  }
}

// Chargement des routes principales
safeMount('/api/contract', './routes/contract');
safeMount('/api/inviter', './routes/inviter');
safeMount('/api/prospect', './routes/prospect');
safeMount('/api/task', './routes/task');
safeMount('/api/deploy', './routes/deploy');
safeMount('/api/hash', './routes/hash');
safeMount('/api/investisseur', './routes/investisseur');
safeMount('/api/projet', './routes/projet');
safeMount('/api/action', './routes/action');
safeMount('/api/blocage', './routes/blocage');

/* ---------------- Introspection dynamique ---------------- */
app.get('/__routes', (req, res) => {
  const routes = [];
  app._router.stack.forEach(middleware => {
    if (middleware.route) {
      // Route directe
      const methods = Object.keys(middleware.route.methods).map(m => m.toUpperCase());
      routes.push({ path: middleware.route.path, methods });
    } else if (middleware.name === 'router' && middleware.handle.stack) {
      middleware.handle.stack.forEach(handler => {
        const route = handler.route;
        if (route) {
          const methods = Object.keys(route.methods).map(m => m.toUpperCase());
          routes.push({ path: route.path, methods });
        }
      });
    }
  });
  res.json({ success: true, total: routes.length, routes });
});

/* ---------------- Gestion d’erreurs ---------------- */
// Erreur interne
app.use((err, _req, res, _next) => {
  console.error('❌ Unhandled error:', err);
  res.status(500).json({
    success: false,
    error: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error',
  });
});

// Route non trouvée
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Route not found',
    path: req.originalUrl,
  });
});

/* ---------------- Démarrage du serveur ---------------- */
async function start() {
  try {
    await web3Service.initialize();
    app.listen(PORT, () => {
      console.log(`🚀 CRM FIPA Microservice running on http://localhost:${PORT}`);
    });
  } catch (e) {
    console.error('❌ Failed to start server:', e.message);
    process.exit(1);
  }
}

start();

module.exports = app;
