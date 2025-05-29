const express = require("express");
const router = express.Router();
require("dotenv").config({ path: "../.env" });
const { supabase } = require("../server"); // Import only supabase
const { authenticateToken } = require("../middleware/authMiddleware"); // Import middleware

// Middleware to check if the user can review the booking
const canReviewBooking = async (req, res, next) => {
    const bookingId = req.body.booking_id; // Get booking_id from request body
    const clientId = req.user.id; // Assumes authenticateToken ran before

    if (!supabase) {
        return res.status(500).json({ error: "Cliente Supabase não inicializado." });
    }
    if (!bookingId) {
        return res.status(400).json({ error: "ID do Agendamento (booking_id) é obrigatório." });
    }

    try {
        // Fetch booking details
        const { data: bookingData, error: bookingError } = await supabase
            .from("bookings")
            .select("client_id, provider_id, status")
            .eq("id", bookingId)
            .single();

        if (bookingError || !bookingData) {
            console.error("Erro ao buscar agendamento para avaliação:", bookingError);
            return res.status(404).json({ error: "Agendamento não encontrado." });
        }

        // Check if the authenticated user is the client
        if (bookingData.client_id !== clientId) {
            return res.status(403).json({ error: "Acesso negado. Você não é o cliente deste agendamento." });
        }

        // Check if the booking status is 'completed'
        if (bookingData.status !== "completed") {
            return res.status(400).json({ error: `Não é possível avaliar. Status do agendamento: ${bookingData.status}. Deve ser 'completed'.` });
        }

        // Check if a review already exists
        const { data: existingReview, error: reviewCheckError } = await supabase
            .from("reviews")
            .select("id")
            .eq("booking_id", bookingId)
            .maybeSingle();

        if (reviewCheckError) {
            console.error("Erro ao verificar avaliação existente:", reviewCheckError);
            return res.status(500).json({ error: "Erro ao verificar avaliação existente." });
        }

        if (existingReview) {
            return res.status(409).json({ error: "Este agendamento já foi avaliado." });
        }

        req.provider_id = bookingData.provider_id;
        next(); // User can review

    } catch (err) {
        console.error("Erro inesperado ao verificar permissão de avaliação:", err);
        res.status(500).json({ error: "Erro interno ao verificar permissão de avaliação." });
    }
};

// --- Review Routes ---

// POST /api/reviews - Create a new review (Client of completed Booking only)
// authenticateToken is applied before this middleware in server.js or here
router.post("/", authenticateToken, canReviewBooking, async (req, res) => {
    if (!supabase) {
        return res.status(500).json({ error: "Cliente Supabase não inicializado." });
    }

    const { booking_id, rating, comment } = req.body;
    const clientId = req.user.id;
    const providerId = req.provider_id;

    if (rating === undefined || rating < 1 || rating > 5) {
        return res.status(400).json({ error: "Avaliação (rating) é obrigatória e deve ser entre 1 e 5." });
    }

    try {
        // 1. Insert the review
        const { data: reviewData, error: insertError } = await supabase
            .from("reviews")
            .insert({
                booking_id,
                client_id: clientId,
                provider_id: providerId,
                rating,
                comment: comment || null
            })
            .select()
            .single();

        if (insertError) {
            console.error("Erro ao salvar avaliação:", insertError);
            if (insertError.code === '23505') {
                 return res.status(409).json({ error: "Este agendamento já foi avaliado." });
            }
            return res.status(500).json({ error: "Erro interno ao salvar avaliação." });
        }

        // 2. Recalculate and Update Provider's Average Rating
        const { data: avgData, error: avgError } = await supabase
            .from("reviews")
            .select("rating")
            .eq("provider_id", providerId);

        if (avgError) {
            console.error(`Erro ao buscar avaliações para recalcular média do provider ${providerId}:`, avgError);
        } else {
            const totalRatings = avgData.length;
            const sumRatings = avgData.reduce((sum, review) => sum + review.rating, 0);
            const newAverage = totalRatings > 0 ? (sumRatings / totalRatings) : 0;

            const { error: updateAvgError } = await supabase
                .from("providers")
                .update({ average_rating: newAverage.toFixed(1) })
                .eq("user_id", providerId);

            if (updateAvgError) {
                console.error(`Erro ao atualizar média de avaliação do provider ${providerId}:`, updateAvgError);
            }
        }

        res.status(201).json(reviewData);

    } catch (err) {
        console.error("Erro inesperado ao criar avaliação:", err);
        res.status(500).json({ error: "Erro inesperado no servidor ao criar avaliação." });
    }
});

// GET /api/reviews/provider/:providerId - List reviews for a specific provider (Public)
router.get("/provider/:providerId", async (req, res) => {
    if (!supabase) {
        return res.status(500).json({ error: "Cliente Supabase não inicializado." });
    }
    const { providerId } = req.params;

    try {
        const { data, error } = await supabase
            .from("reviews")
            .select(`
                id,
                rating,
                comment,
                created_at,
                clients:client_id ( users ( full_name ) ) 
            `)
            .eq("provider_id", providerId)
            .order("created_at", { ascending: false });

        if (error) {
            console.error(`Erro ao buscar avaliações para o provider ${providerId}:`, error);
            return res.status(500).json({ error: "Erro interno ao buscar avaliações." });
        }

        res.json(data);

    } catch (err) {
        console.error("Erro inesperado ao buscar avaliações:", err);
        res.status(500).json({ error: "Erro inesperado no servidor." });
    }
});

module.exports = router;

