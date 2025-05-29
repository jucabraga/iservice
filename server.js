require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");

// Import route handlers first
const authRoutes = require("./routes/auth");
const serviceRoutes = require('./routes/services');
const bookingRoutes = require("./routes/bookings");
const reviewRoutes = require("./routes/reviews");
const providerRoutes = require("./routes/providers");
const paymentRoutes = require("./routes/payments");

// --- Configuração do Express ---
const app = express();
const port = process.env.PORT || 3000;

// --- Middlewares ---
app.use(cors()); // Habilita CORS para todas as origens (ajustar em produção)

// Stripe webhook endpoint needs raw body - Mount it BEFORE express.json()
// Note: We mount the *specific* webhook route from payments.js here.
// Ensure the payments.js router exports the webhook handler separately or handles the path.
// Assuming payments.js handles POST /webhook internally:
app.use("/api/payments", paymentRoutes); // Mount the payment router here, it should handle the raw parsing internally for its specific route.

app.use(express.json()); // Para parsear JSON no corpo das requisições para outras rotas

// --- Configuração do Supabase Client ---
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey || supabaseUrl === 'YOUR_SUPABASE_URL') {
  console.error("Erro: Variáveis de ambiente SUPABASE_URL e SUPABASE_ANON_KEY são obrigatórias e devem ser configuradas no arquivo .env");
}

const supabase = supabaseUrl && supabaseAnonKey && supabaseUrl !== 'YOUR_SUPABASE_URL' ? createClient(supabaseUrl, supabaseAnonKey) : null;

// --- Middleware de Autenticação ---
const authenticateToken = async (req, res, next) => {
  if (!supabase) {
    return res.status(500).json({ error: "Cliente Supabase não inicializado. Verifique as configurações .env." });
  }
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1]; // Bearer TOKEN

  if (token == null) return res.sendStatus(401); // Se não há token, não autorizado

  try {
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) {
        console.error("Erro ao validar token ou usuário não encontrado:", error);
        return res.sendStatus(403); // Token inválido ou expirado
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
    if (req.user && req.user.user_metadata && req.user.user_metadata.role === 'provider') {
        next();
    } else {
        res.status(403).json({ error: "Acesso negado. Rota exclusiva para prestadores." });
    }
};

// --- Montagem das Rotas ---

app.get("/", (req, res) => {
  res.json({ message: "Bem-vindo à API do App de Serviços!" });
});

// Rotas de Autenticação (públicas)
app.use("/api/auth", authRoutes);

// Rotas de Categorias (exemplo, pública)
app.get("/api/categories", async (req, res) => {
  if (!supabase) {
    return res.status(500).json({ error: "Cliente Supabase não inicializado." });
  }
  try {
    const { data, error } = await supabase.from("categories").select("*");
    if (error) throw error;
    res.json(data);
  } catch (error) {
    console.error("Erro ao buscar categorias:", error);
    res.status(500).json({ error: "Erro interno ao buscar categorias." });
  }
});

// Rotas que geralmente requerem autenticação
app.use("/api/bookings", authenticateToken, bookingRoutes);
app.use("/api/reviews", reviewRoutes); // Auth handled internally where needed
app.use("/api/providers", providerRoutes); // Auth handled internally where needed
app.use("/api/services", serviceRoutes); // Auth handled internally where needed

// Note: Payment routes (except webhook) might also need authenticateToken, handled within payments.js or apply middleware here if needed.

// --- Inicialização do Servidor ---
app.listen(port, () => {
  console.log(`Servidor backend rodando na porta ${port}`);
  if (!supabase) {
    console.warn("Atenção: Servidor rodando, mas a conexão com Supabase não foi estabelecida devido à falta de credenciais ou URL inválida no .env");
  }
});

// Exporta o app, supabase e middlewares para possível uso em testes ou outros módulos
module.exports = { app, supabase, authenticateToken, isProvider };

