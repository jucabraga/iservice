const express = require("express");
const router = express.Router();
const { supabase } = require("../server"); // Import only supabase from server
const { authenticateToken, isProvider } = require("../middleware/authMiddleware"); // Import middlewares

// Middleware to verify if the provider owns the service
const isServiceOwner = async (req, res, next) => {
    const serviceId = req.params.id;
    const providerId = req.user.id; // Assumes authenticateToken ran before

    if (!supabase) {
        return res.status(500).json({ error: "Cliente Supabase não inicializado." });
    }

    try {
        const { data, error } = await supabase
            .from("services")
            .select("provider_id")
            .eq("id", serviceId)
            .single();

        if (error || !data) {
            console.error("Erro ao buscar serviço ou serviço não encontrado:", error);
            return res.status(404).json({ error: "Serviço não encontrado." });
        }

        if (data.provider_id !== providerId) {
            return res.status(403).json({ error: "Acesso negado. Você não é o proprietário deste serviço." });
        }

        next(); // User is the owner, proceed
    } catch (err) {
        console.error("Erro inesperado ao verificar proprietário do serviço:", err);
        res.status(500).json({ error: "Erro interno ao verificar propriedade do serviço." });
    }
};

// --- Service CRUD Routes ---

// POST /api/services - Create a new service (Providers Only)
router.post("/", authenticateToken, isProvider, async (req, res) => {
    if (!supabase) {
        return res.status(500).json({ error: "Cliente Supabase não inicializado." });
    }
    const providerId = req.user.id;
    const { category_id, title, description, price, duration_estimate } = req.body;

    if (!category_id || !title || !description || price === undefined) {
        return res.status(400).json({ error: "Campos obrigatórios: category_id, title, description, price." });
    }

    try {
        const { data, error } = await supabase
            .from("services")
            .insert({
                provider_id: providerId,
                category_id,
                title,
                description,
                price,
                duration_estimate,
                is_active: true
            })
            .select()
            .single();

        if (error) {
            console.error("Erro ao criar serviço:", error);
            return res.status(500).json({ error: "Erro interno ao criar serviço." });
        }

        res.status(201).json(data);
    } catch (err) {
        console.error("Erro inesperado ao criar serviço:", err);
        res.status(500).json({ error: "Erro inesperado no servidor." });
    }
});

// GET /api/services - List all active services (Public)
router.get("/", async (req, res) => {
    if (!supabase) {
        return res.status(500).json({ error: "Cliente Supabase não inicializado." });
    }
    try {
        const { data, error } = await supabase
            .from("services")
            .select(`
                id,
                title,
                price,
                description,
                duration_estimate,
                categories ( name ),
                providers (
                    user_id,
                    is_verified,
                    average_rating,
                    users ( full_name )
                )
            `)
            .eq("is_active", true);

        if (error) {
            console.error("Erro ao listar serviços:", error);
            return res.status(500).json({ error: "Erro interno ao listar serviços." });
        }

        res.json(data);
    } catch (err) {
        console.error("Erro inesperado ao listar serviços:", err);
        res.status(500).json({ error: "Erro inesperado no servidor." });
    }
});

// GET /api/services/:id - Get details of a specific service (Public)
router.get("/:id", async (req, res) => {
    if (!supabase) {
        return res.status(500).json({ error: "Cliente Supabase não inicializado." });
    }
    const { id } = req.params;

    try {
        const { data, error } = await supabase
            .from("services")
            .select(`
                *,
                categories ( * ),
                providers (
                    *,
                    users ( * )
                )
            `)
            .eq("id", id)
            .eq("is_active", true)
            .single();

        if (error) {
            if (error.code === 'PGRST116') {
                 return res.status(404).json({ error: "Serviço não encontrado ou inativo." });
            }
            console.error("Erro ao buscar detalhes do serviço:", error);
            return res.status(500).json({ error: "Erro interno ao buscar detalhes do serviço." });
        }

        res.json(data);
    } catch (err) {
        console.error("Erro inesperado ao buscar serviço:", err);
        res.status(500).json({ error: "Erro inesperado no servidor." });
    }
});

// PUT /api/services/:id - Update a service (Provider owner only)
router.put("/:id", authenticateToken, isProvider, isServiceOwner, async (req, res) => {
    if (!supabase) {
        return res.status(500).json({ error: "Cliente Supabase não inicializado." });
    }
    const { id } = req.params;
    const { category_id, title, description, price, duration_estimate, is_active } = req.body;

    const updates = {};
    if (category_id !== undefined) updates.category_id = category_id;
    if (title !== undefined) updates.title = title;
    if (description !== undefined) updates.description = description;
    if (price !== undefined) updates.price = price;
    if (duration_estimate !== undefined) updates.duration_estimate = duration_estimate;
    if (is_active !== undefined) updates.is_active = is_active;

    if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: "Nenhum campo fornecido para atualização." });
    }

    updates.updated_at = new Date();

    try {
        const { data, error } = await supabase
            .from("services")
            .update(updates)
            .eq("id", id)
            .select()
            .single();

        if (error) {
            console.error("Erro ao atualizar serviço:", error);
            return res.status(500).json({ error: "Erro interno ao atualizar serviço." });
        }

        res.json(data);
    } catch (err) {
        console.error("Erro inesperado ao atualizar serviço:", err);
        res.status(500).json({ error: "Erro inesperado no servidor." });
    }
});

// DELETE /api/services/:id - Deactivate a service (Provider owner only)
router.delete("/:id", authenticateToken, isProvider, isServiceOwner, async (req, res) => {
    if (!supabase) {
        return res.status(500).json({ error: "Cliente Supabase não inicializado." });
    }
    const { id } = req.params;

    try {
        const { data, error } = await supabase
            .from("services")
            .update({ is_active: false, updated_at: new Date() })
            .eq("id", id)
            .select()
            .single();

        if (error) {
            console.error("Erro ao desativar serviço:", error);
            return res.status(500).json({ error: "Erro interno ao desativar serviço." });
        }

        res.status(200).json({ message: "Serviço desativado com sucesso.", service: data });

    } catch (err) {
        console.error("Erro inesperado ao desativar serviço:", err);
        res.status(500).json({ error: "Erro inesperado no servidor." });
    }
});

module.exports = router;

