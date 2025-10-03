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
app.get('/', async (req, res) => {
  try {
    const { data: products, error } = await supabase
      .from('data')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;

    res.render('index', {
      title: 'Bienvenue sur Karla Shopping',
      message: 'Votre boutique en ligne préférée ! 🛍️',

      // --- Métadonnées SEO ---
      description: "Karla Shopping - Boutique en ligne avec produits de qualité, livraison rapide et paiement sécurisé.",
      keywords: "shopping, boutique en ligne, karla shopping, produits, mode, accessoires, livraison rapide, paiement sécurisé",
      author: "Karla Shopping",
      canonicalUrl: "http://localhost:3000/",

      features: [
        { title: '✅ Produits de qualité', description: 'Nos produits sont rigoureusement sélectionnés pour garantir une qualité irréprochable.' },
        { title: '✅ Livraison rapide', description: 'Recevez vos commandes en un temps record grâce à notre logistique optimisée.' },
        { title: '✅ Service client 24/7', description: 'Notre équipe est disponible à toute heure pour répondre à vos besoins.' },
        { title: '✅ Paiement sécurisé', description: 'Toutes les transactions sont protégées par des protocoles de sécurité avancés.' },
      ],

      products,
    });

  } catch (err) {
    console.error(err);
    res.render('index', {
      title: 'Bienvenue sur Karla Shopping',
      message: 'Votre boutique en ligne préférée ! 🛍️',

      // --- Métadonnées SEO fallback ---
      description: "Karla Shopping - Découvrez nos produits disponibles en ligne avec une expérience shopping fluide.",
      keywords: "boutique en ligne, shopping, karla, produits, ecommerce",
      author: "Karla Shopping",
      canonicalUrl: "https://karlashopping.onrender.com/",

      features: [
        { title: '✅ Produits de qualité', description: 'Nos produits sont rigoureusement sélectionnés pour garantir une qualité irréprochable.' },
        { title: '✅ Livraison rapide', description: 'Recevez vos commandes en un temps record grâce à notre logistique optimisée.' },
        { title: '✅ Service client 24/7', description: 'Notre équipe est disponible à toute heure pour répondre à vos besoins.' },
        { title: '✅ Paiement sécurisé', description: 'Toutes les transactions sont protégées par des protocoles de sécurité avancés.' },
      ],

      products: [],
    });
  }
});

// Page détail produit
app.get('/produit/:id', async (req, res) => {
  const { id } = req.params;

  const { data: product, error } = await supabase
    .from('data')
    .select('*')
    .eq('id', id)
    .single();

  if (error || !product) {
    return res.status(404).render('404', { message: 'Produit introuvable' });
  }

  res.render('product_detail', {
    title: product.title,
    product,

    // --- Métadonnées dynamiques ---
    description: product.description || `Découvrez ${product.title} sur Karla Shopping.`,
    keywords: `${product.title}, ${product.brand}, ${product.category}, shopping, karla`,
    author: "Karla Shopping",
    canonicalUrl: `https://karlashopping.onrender.com/produit/${id}`,

    isAdmin: req.session.isAdmin || false
  });
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
app.get('/upload', (req, res) => {
  if (!req.session.isAdmin) return res.status(403).send('Accès refusé');
  res.render('upload', { title: 'Upload Produit' });
});

const { v4: uuidv4 } = require('uuid');

function sanitizeFileName(filename) {
  return filename
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9.-]/g, '_');
}

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

      // Main image
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

      // Secondary images
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

      // Insert record
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

// ROUTE CATALOGUE CORRIGÉE - avec isAdmin
app.get('/catalogue', async (req, res) => {
  const { q, category, brand, price_min, price_max, condition, is_available } = req.query;

  try {
    let query = supabase.from('data').select('*');

    // Recherche texte
    if (q && q.trim() !== '') {
      query = query.or(`title.ilike.%${q.trim()}%,description.ilike.%${q.trim()}%`);
    }

    // Filtre catégorie
    if (category && category.trim() !== '') {
      query = query.eq('category', category.trim());
    }

    // Filtre marque
    if (brand && brand.trim() !== '') {
      query = query.ilike('brand', `%${brand.trim()}%`);
    }

    // Filtre prix
    if (price_min) query = query.gte('price', Number(price_min));
    if (price_max) query = query.lte('price', Number(price_max));

    // Filtre condition
    if (condition && condition.trim() !== '') {
      query = query.eq('condition', condition.trim());
    }

    // Filtre disponibilité
    if (is_available === 'true') query = query.eq('is_available', true);
    if (is_available === 'false') query = query.eq('is_available', false);

    const { data: products, error } = await query;

    if (error) {
      console.error('Erreur Supabase:', error);
      return res.render('catalogue', { 
        products: [], 
        filters: req.query,
        isAdmin: req.session.isAdmin || false // ← AJOUT DE isAdmin
      });
    }

    res.render('catalogue', { 
      products: products || [], 
      filters: req.query,
      isAdmin: req.session.isAdmin || false // ← AJOUT DE isAdmin
    });
  } catch (err) {
    console.error('Erreur serveur:', err);
    res.render('catalogue', { 
      products: [], 
      filters: req.query,
      isAdmin: req.session.isAdmin || false // ← AJOUT DE isAdmin
    });
  }
});

// Page détail produit
app.get('/produit/:id', async (req, res) => {
  const { id } = req.params;

  const { data: product, error } = await supabase
    .from('data')
    .select('*')
    .eq('id', id)
    .single();

  if (error || !product) {
    return res.status(404).render('404', { message: 'Produit introuvable' });
  }

  res.render('product_detail', {
    title: product.title,
    product,
     // Métadonnées dynamiques
    description: product.description || `Découvrez ${product.title} sur Karla Shopping.`,
    keywords: `${product.title}, ${product.brand}, ${product.category}, shopping, karla shopping`,
    author: "Karla Shopping",
    canonicalUrl:`https://karlashopping.onrender.com/produit/${id}`,
    isAdmin: req.session.isAdmin || false // ← AJOUT DE isAdmin pour la page détail aussi
  });
});

// Route pour supprimer un produit (POST) - AVEC LOGS
app.post('/product/delete/:id', async (req, res) => {
    console.log('=== TENTATIVE DE SUPPRESSION ===');
    console.log('URL appelée:', req.originalUrl);
    console.log('Méthode:', req.method);
    console.log('Session user:', req.session.user);
    console.log('isAdmin:', req.session.isAdmin);
    console.log('Product ID:', req.params.id);
    
    // Vérifier si l'utilisateur est admin
    if (!req.session.isAdmin) {
        console.log('❌ ACCÈS REFUSÉ - Pas admin');
        return res.status(403).send('Accès non autorisé');
    }

    const productId = req.params.id;

    try {
        console.log('🗑️ Suppression du produit ID:', productId);
        
        // Vérifiez d'abord si le produit existe
        const { data: existingProduct, error: findError } = await supabase
            .from('data')
            .select('id')
            .eq('id', productId)
            .single();
            
        if (findError || !existingProduct) {
            console.log('❌ Produit non trouvé');
            return res.status(404).send('Produit non trouvé');
        }
        
        console.log('✅ Produit trouvé, suppression...');
        
        const { data, error } = await supabase
            .from('data')
            .delete()
            .eq('id', productId);

        console.log('Résultat Supabase:', { data, error });

        if (error) throw error;

        console.log('✅ Produit supprimé avec succès');
        res.redirect('/catalogue');
        
    } catch (err) {
        console.error('❌ Erreur suppression:', err);
        res.status(500).send('Erreur serveur : ' + err.message);
    }
});

// Route API pour supprimer un produit (DELETE)
app.delete('/api/products/:id', async (req, res) => {
  try {
    // Vérifier si l'utilisateur est admin via la session
    if (!req.session.isAdmin) {
      return res.status(403).json({ error: 'Accès non autorisé' });
    }

    const productId = req.params.id;
    
    // Supprime le produit
    const { error: deleteError } = await supabase
      .from('data') // Utilisez 'data' au lieu de 'products'
      .delete()
      .eq('id', productId);
        
    if (deleteError) {
      throw deleteError;
    }
    
    res.json({ success: true, message: 'Produit supprimé avec succès' });
    
  } catch (error) {
    console.error('Erreur suppression produit:', error);
    res.status(500).json({ error: 'Erreur lors de la suppression du produit' });
  }
});
//
app.get('/sitemap.xml', async (req, res) => {
  try {
    const { data: products, error } = await supabase
      .from('data')
      .select('id, updated_at, created_at')
      .order('updated_at', { ascending: false });

    if (error) throw error;

    const today = new Date().toISOString().split('T')[0];

    let urls = `
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://karlashopping.onrender.com/</loc>
    <lastmod>${today}</lastmod>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>`;

    products.forEach(p => {
      const lastModDate = p.updated_at || p.created_at || today;
      const lastMod = new Date(lastModDate).toISOString().split('T')[0];

      // Calcul de la priorité : plus récent = priorité plus élevée
      const daysSinceUpdate = Math.floor((new Date() - new Date(lastModDate)) / (1000 * 60 * 60 * 24));
      let priority = 0.5; // valeur par défaut
      if (daysSinceUpdate <= 7) priority = 1.0;
      else if (daysSinceUpdate <= 30) priority = 0.9;
      else if (daysSinceUpdate <= 90) priority = 0.8;

      urls += `
  <url>
    <loc>https://karlashopping.onrender.com/produit/${p.id}</loc>
    <lastmod>${lastMod}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>${priority.toFixed(1)}</priority>
  </url>`;
    });

    urls += `\n</urlset>`;

    res.header('Content-Type', 'application/xml');
    res.send(urls);
  } catch (err) {
    console.error(err);
    res.status(500).send('Erreur génération sitemap');
  }
});


// --- Lancement serveur ---
app.listen(PORT, () => console.log(`✅ Serveur lancé sur http://localhost:${PORT}`));