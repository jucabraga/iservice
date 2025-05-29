const express = require("express");
const router = express.Router();
require("dotenv").config({ path: "../.env" });
const { supabase } = require("../server"); // Import only supabase
const { authenticateToken, isProvider, isAdmin } = require("../middleware/authMiddleware"); // Import middlewares

// --- Provider Routes (Focus on Verification) ---

// POST /api/providers/request-verification - Provider requests verification
router.post("/request-verification", authenticateToken, isProvider, async (req, res) => {
    if (!supabase) {
        return res.status(500).json({ error: "Cliente Supabase não inicializado." });
    }
    const providerId = req.user.id;
    const { document_urls } = req.body; // Expecting an array of URLs

    try {
        // Check current status first
        const { data: currentProvider, error: fetchError } = await supabase
            .from("providers")
            .select("verification_status")
            .eq("user_id", providerId)
            .single();

        if (fetchError) {
            console.error("Erro ao buscar status de verificação atual:", fetchError);
            return res.status(500).json({ error: "Erro ao verificar status atual." });
        }

        if (currentProvider.verification_status === 'pending' || currentProvider.verification_status === 'approved') {
            return res.status(400).json({ error: `Solicitação já está ${currentProvider.verification_status}.` });
        }

        // Update provider status to 'pending'
        const { data, error } = await supabase
            .from("providers")
            .update({
                verification_status: "pending",
                verification_documents_url: document_urls || null, // Store document URLs if provided
                updated_at: new Date()
            })
            .eq("user_id", providerId)
            .select("verification_status"); // Return the new status

        if (error) {
            console.error("Erro ao solicitar verificação:", error);
            return res.status(500).json({ error: "Erro interno ao solicitar verificação." });
        }

        res.status(200).json({ message: "Solicitação de verificação enviada com sucesso.", status: data[0]?.verification_status });

    } catch (err) {
        console.error("Erro inesperado ao solicitar verificação:", err);
        res.status(500).json({ error: "Erro inesperado no servidor." });
    }
});

// PUT /api/providers/:id/update-verification-status - Admin updates verification status
// :id here refers to the user_id of the provider
router.put("/:id/update-verification-status", authenticateToken, isAdmin, async (req, res) => {
    if (!supabase) {
        return res.status(500).json({ error: "Cliente Supabase não inicializado." });
    }
    const providerId = req.params.id;
    const { new_status } = req.body; // Expecting 'approved' or 'rejected'

    if (!new_status || (new_status !== 'approved' && new_status !== 'rejected')) {
        return res.status(400).json({ error: "Status inválido. Use 'approved' ou 'rejected'." });
    }

    try {
        const updatePayload = {
            verification_status: new_status,
            is_verified: new_status === 'approved', // Update is_verified based on status
            updated_at: new Date()
        };

        const { data, error } = await supabase
            .from("providers")
            .update(updatePayload)
            .eq("user_id", providerId)
            .select("user_id, verification_status, is_verified");

        if (error) {
            console.error(`Erro ao atualizar status de verificação para ${providerId}:`, error);
            if (error.code === 'PGRST116') { // Row not found
                return res.status(404).json({ error: "Prestador não encontrado." });
            }
            return res.status(500).json({ error: "Erro interno ao atualizar status." });
        }

        if (!data || data.length === 0) {
             return res.status(404).json({ error: "Prestador não encontrado." });
        }

        // TODO: Notify provider about the status update
        console.log(`Status de verificação do prestador ${providerId} atualizado para ${new_status}.`);
        res.status(200).json({ message: `Status de verificação atualizado para ${new_status}.`, provider: data[0] });

    } catch (err) {
        console.error("Erro inesperado ao atualizar status de verificação:", err);
        res.status(500).json({ error: "Erro inesperado no servidor." });
    }
});

// GET /api/providers/:id/verification-status - Get verification status (Admin or the Provider themselves)
// isAdmin middleware handles the permission check including self-access
router.get("/:id/verification-status", authenticateToken, isAdmin, async (req, res) => {
     if (!supabase) {
        return res.status(500).json({ error: "Cliente Supabase não inicializado." });
    }
    const providerId = req.params.id;

    try {
         const { data, error } = await supabase
            .from("providers")
            .select("user_id, verification_status, is_verified, verification_documents_url, updated_at")
            .eq("user_id", providerId)
            .single();

        if (error) {
            console.error(`Erro ao buscar status de verificação para ${providerId}:`, error);
            if (error.code === 'PGRST116') { // Row not found
                return res.status(404).json({ error: "Prestador não encontrado." });
            }
            return res.status(500).json({ error: "Erro interno ao buscar status." });
        }

        res.json(data);

    } catch (err) {
         console.error("Erro inesperado ao buscar status de verificação:", err);
        res.status(500).json({ error: "Erro inesperado no servidor." });
    }
});


module.exports = router;

