 require('dotenv').config();
const express = require('express');
const path = require('path');
const session = require('express-session');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;

// --- Supabase ---
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// --- Middleware ---
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: true,
}));

// --- Moteur de templates ---
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// --- Passer la session aux templates ---
app.use((req, res, next) => {
  res.locals.session = req.session;
  next();
});

// ----------------- ROUTES -----------------

// Page d'accueil
// Page d'accueil avec affichage des produits
app.get('/', async (req, res) => {
  try {
    // Récupérer les produits depuis la table "data"
    const { data: products, error } = await supabase
      .from('data')
      .select('*')
      .order('created_at', { ascending: false }); // si tu as un champ timestamp/created_at

    if (error) throw error;

    res.render('index', {
      title: 'Bienvenue sur Karla Shopping',
      message: 'Votre boutique en ligne préférée ! 🛍️',
      features: [
        '✅ Produits de qualité',
        '✅ Livraison rapide',
        '✅ Service client 24/7',
        '✅ Paiement sécurisé',
      ],
      products, // <-- on passe les produits au template
    });

  } catch (err) {
    console.error(err);
    res.render('index', {
      title: 'Bienvenue sur Karla Shopping',
      message: 'Votre boutique en ligne préférée ! 🛍️',
      features: [
        '✅ Produits de qualité',
        '✅ Livraison rapide',
        '✅ Service client 24/7',
        '✅ Paiement sécurisé',
      ],
      products: [], // pas de produits en cas d'erreur
    });
  }
});

// Page produits
app.get('/products', (req, res) => {
  res.render('products', { title: 'Nos Produits' });
});

// Déconnexion
app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

// --- SIGNUP ---
app.post('/signup', async (req, res) => {
  const { email, password } = req.body;

  // Création compte
  const { data, error } = await supabase.auth.signUp({ email, password });

  if (error) {
    // S'il existe déjà, on se connecte directement
    if (error.message.includes('User already registered')) {
      const { data: loginData, error: loginError } = await supabase.auth.signInWithPassword({ email, password });
      if (loginError) return res.send(loginError.message);

      const user = loginData.user;
      // Vérifie si admin
      const { data: adminRecord } = await supabase
        .from('app_admins')
        .select('*')
        .eq('id', user.id)
        .maybeSingle();

      req.session.user = { id: user.id, email: user.email };
      req.session.isAdmin = !!adminRecord;

      return res.redirect('/');
    }
    return res.send(error.message);
  }

  // Nouvel utilisateur
  const user = data.user;
  const { data: adminRecord } = await supabase
    .from('app_admins')
    .select('*')
    .eq('id', user.id)
    .maybeSingle();

  req.session.user = { id: user.id, email: user.email };
  req.session.isAdmin = !!adminRecord;

  res.redirect('/');
});

// --- LOGIN ---
app.post('/login', async (req, res) => {
  const { email, password } = req.body;

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return res.send(error.message);

  const user = data.user;
  const { data: adminRecord } = await supabase
    .from('app_admins')
    .select('*')
    .eq('id', user.id)
    .maybeSingle();

  req.session.user = { id: user.id, email: user.email };
  req.session.isAdmin = !!adminRecord;

  res.redirect('/');
});


// --- Multer ---
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });

// --- ROUTES UPLOAD ---

// Page d’upload (GET) – réservé aux admins
app.get('/upload', (req, res) => {
  if (!req.session.isAdmin) return res.status(403).send('Accès refusé');
  res.render('upload', { title: 'Upload Produit' });
});

const { v4: uuidv4 } = require('uuid');

// Fonction pour nettoyer le nom de fichier
function sanitizeFileName(filename) {
  return filename
    .normalize('NFD')                 // décompose accents
    .replace(/[\u0300-\u036f]/g, '') // retire les accents
    .replace(/[^a-zA-Z0-9.-]/g, '_'); // remplace les caractères spéciaux
}

// POST Upload – réservé aux admins
app.post(
  '/upload',
  upload.fields([
    { name: 'main_image', maxCount: 1 },
    { name: 'secondary_images', maxCount: 5 }
  ]),
  async (req, res) => {
    if (!req.session.isAdmin) return res.status(403).send('Accès refusé');

    try {
      const userId = req.session.user.id;
      const {
        title,
        brand,
        price,
        quantity,
        category,
        condition,
        description,
        features,
        location,
        delivery
      } = req.body;

      const productFolder = `uploads/${Date.now()}`;

      // --- Main image ---
      const mainFile = req.files['main_image'][0];
      const safeMainName = sanitizeFileName(mainFile.originalname);
      const uniqueMainName = `${Date.now()}_${uuidv4()}_${safeMainName}`;
      const mainPath = `${productFolder}/${uniqueMainName}`;

      const { error: mainError } = await supabase
        .storage
        .from('images')
        .upload(mainPath, mainFile.buffer, { cacheControl: '3600', upsert: false });

      if (mainError) throw mainError;

      const mainImageUrl = supabase.storage.from('images').getPublicUrl(mainPath).data.publicUrl;

      // --- Secondary images ---
      let secondaryImageUrls = [];
      if (req.files['secondary_images']) {
        const files = req.files['secondary_images'].slice(0, 5);
        for (const file of files) {
          const safeName = sanitizeFileName(file.originalname);
          const uniqueName = `${Date.now()}_${uuidv4()}_${safeName}`;
          const secPath = `${productFolder}/${uniqueName}`;

          const { error } = await supabase
            .storage
            .from('images')
            .upload(secPath, file.buffer, { cacheControl: '3600', upsert: false });
          if (error) throw error;

          secondaryImageUrls.push({
            url: supabase.storage.from('images').getPublicUrl(secPath).data.publicUrl
          });
        }
      }

      // --- Insert record in table ---
      const { error } = await supabase.from('data').insert([{
        user_id: userId,
        main_image_url: mainImageUrl,
        secondary_image_urls: JSON.stringify(secondaryImageUrls),
        title,
        brand,
        price,
        quantity,
        category,
        condition,
        description,
        features,
        location,
        delivery,
        is_available: true
      }]);

      if (error) throw error;

      res.send('✅ Produit uploadé avec succès !');
    } catch (err) {
      res.status(500).send('Erreur upload : ' + err.message);
    }
  }
);
// Route pour supprimer un produit
app.post('/product/delete/:id', async (req, res) => {
  const productId = req.params.id;

  try {
    const { error } = await supabase
      .from('data')
      .delete()
      .eq('id', productId);

    if (error) throw error;

     res.redirect('/');
  } catch (err) {
    console.error(err);
    res.status(500).send('Erreur serveur : ' + err.message);
  }
});

// Page détail produit
app.get('/product/:id', async (req, res) => {
  const productId = req.params.id;

  try {
    // Récupérer le produit depuis Supabase
    const { data: product, error } = await supabase
      .from('data')
      .select('*')
      .eq('id', productId)
      .maybeSingle();

    if (error) throw error;
    if (!product) return res.status(404).send('Produit non trouvé');

    res.render('product_detail', {
      title: product.title,
      product
    });

  } catch (err) {
    console.error(err);
    res.status(500).send('Erreur serveur : ' + err.message);
  }
});



// --- Lancement serveur ---
app.listen(PORT, () => console.log(`✅ Serveur lancé sur http://localhost:${PORT}`));
