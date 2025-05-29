require("dotenv").config({ path: "../.env" }); // Load .env from parent directory
const { createClient } = require("@supabase/supabase-js");

// Initialize Supabase client within the middleware file
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

let supabase = null;
if (supabaseUrl && supabaseAnonKey && supabaseUrl !== 'YOUR_SUPABASE_URL') {
    supabase = createClient(supabaseUrl, supabaseAnonKey);
} else {
    console.error("Middleware: Supabase URL or Anon Key not configured correctly in .env");
}

// Middleware de Autenticação
const authenticateToken = async (req, res, next) => {
  if (!supabase) {
    return res.status(500).json({ error: "Cliente Supabase não inicializado no middleware. Verifique as configurações .env." });
  }
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1]; // Bearer TOKEN

  if (token == null) return res.sendStatus(401); // Se não há token, não autorizado

  try {
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) {
        console.error("Erro ao validar token ou usuário não encontrado:", error);
        // Distinguish between invalid token and other errors if possible
        return res.status(403).json({ error: "Token inválido ou expirado." }); // Use 403 for forbidden
    }
    req.user = user; // Adiciona o objeto user à requisição
    next(); // Passa para a próxima rota/middleware
  } catch (err) {
      console.error("Erro inesperado na autenticação:", err);
      return res.sendStatus(500);
  }
};

// Middleware para verificar se o usuário é um Prestador (Provider)
const isProvider = (req, res, next) => {
    // This middleware MUST run AFTER authenticateToken
    if (!req.user) {
        return res.status(401).json({ error: "Usuário não autenticado." });
    }
    if (req.user.user_metadata && req.user.user_metadata.role === 'provider') {
        next();
    } else {
        res.status(403).json({ error: "Acesso negado. Rota exclusiva para prestadores." });
    }
};

// Middleware (Placeholder) for checking Admin role - Replace with actual implementation
const isAdmin = (req, res, next) => {
    // This middleware MUST run AFTER authenticateToken
    if (!req.user) {
        return res.status(401).json({ error: "Usuário não autenticado." });
    }
    // WARNING: This is a placeholder and NOT secure. Implement proper role checking.
    const isAdminUser = req.user?.user_metadata?.role === 'admin'; // Example check

    if (isAdminUser) {
        next();
    } else {
        // Allow provider to view their own verification status even if not admin
        if (req.params.id && req.user?.id === req.params.id && req.method === 'GET' && req.baseUrl.includes('/api/providers') && req.path.includes('/verification-status')) {
             console.log(`Permitindo acesso do provider ${req.user.id} ao seu próprio status de verificação.`);
             return next();
        }
        res.status(403).json({ error: "Acesso negado. Requer privilégios de administrador." });
    }
};


module.exports = { authenticateToken, isProvider, isAdmin };

